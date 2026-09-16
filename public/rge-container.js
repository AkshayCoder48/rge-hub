/**
 * RGE Hub - agent web container worker (PLAIN JavaScript, classic worker).
 *
 * This file is loaded by the main thread as:
 *
 *     new Worker('/rge-container.js')
 *
 * so it must NOT use ES module syntax (no import/export). It pulls Pyodide
 * (Python 3.12 compiled to WASM) from the jsDelivr CDN with importScripts()
 * and owns an in-memory filesystem (MEMFS) with ONE WORKSPACE PER AGENT CHAT:
 *
 *     /workspace/<workspaceId>/
 *         hub/        files fetched from hub resources
 *         extracted/  default target of extractZip / unzip
 *         output/     default target of createZip / agent output
 *
 * It is a RESOURCE-PROCESSING container (XML/ZIP workflows), not a dev IDE.
 *
 * PROTOCOL (see src/lib/agent/container-types.ts for the exact contract):
 *
 *   main -> worker : { type: 'rpc', id: number, op: string, args: object }
 *
 *   worker -> main : { type: 'ready' }
 *                   { type: 'boot-error', message: string }
 *                   { type: 'rpc', id, ok: true, result }
 *                   { type: 'rpc', id, ok: false, error: string }
 *                   { type: 'fs', workspace, paths: [{ path, dir }] }
 *                       (paths: [{ path: '*', dir: true }] means "anything may
 *                        have changed - refresh the whole listing")
 *                   { type: 'stdout'|'stderr', execId, text }
 *                   { type: 'exec-end', execId, ok, error?, durationMs }
 *
 * GUARANTEES:
 *   - The worker NEVER throws at top level and a failed RPC NEVER kills it;
 *     every dispatch is wrapped and answered with ok:false instead.
 *   - Pyodide boots LAZILY: the first RPC starts the boot; all RPCs that
 *     arrive during the boot are queued and run in order once ready.
 *   - Only ONE exec (execCode/execCommand) runs at a time. A second exec RPC
 *     arriving mid-run is answered with a "Container busy" error. Regular
 *     (non-exec) RPCs are still served while an exec runs - they are short,
 *     synchronous Python calls and cannot corrupt the filesystem.
 *   - All paths are workspace-relative. '..' segments, absolute paths,
 *     backslashes, empty paths and disallowed ASCII characters are rejected.
 *
 * ASCII ONLY in this file (no emojis, no unicode punctuation).
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Section: constants
  // -----------------------------------------------------------------------

  const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

  const MAX_LIST_NODES = 800;          // list() node cap
  const MAX_LIST_DEPTH = 14;           // list() depth cap
  const READ_CAP_BYTES = 65536;        // read() default AND hard cap for maxBytes
  const OUTPUT_STREAM_CAP = 256 * 1024; // exec stdout+stderr capture cap (256 KB)
  const OUTPUT_RESULT_CAP = 64 * 1024;  // exec result 'output' cap (64 KB, tail kept)
  const TRACEBACK_TAIL = 15;           // execCode error = last N traceback lines
  const OP_ERROR_TAIL = 3;             // op errors = last N traceback lines
  const MAX_PATH_LEN = 512;

  // Characters allowed in the ASCII range of a workspace-relative path.
  // Anything non-ASCII (unicode filenames) is allowed.
  const REL_ALLOWED =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-/ ';

  // -----------------------------------------------------------------------
  // Section: state
  // -----------------------------------------------------------------------

  // Worker lifecycle: 'idle' (fresh, pyodide not loaded yet) ->
  // 'booting' -> 'ready' | 'error' (error is terminal until the worker is
  // re-created by the main thread).
  let state = 'idle';

  // RPCs received while booting; drained in order once ready.
  const bootQueue = [];

  // The currently running exec, or null. Set by beginExec(), cleared by
  // endExec(). stdout/stderr callbacks only forward while this is set.
  let currentExec = null;

  // The pyodide instance and its 'rge' helper namespace (PyProxy), set at
  // boot. Hung off `self` so a debugger can inspect them.
  //   self.pyodide - the pyodide runtime
  //   self.rge     - the bootstrap python module (see BOOTSTRAP_PY below)

  // UTF-8 helpers (available in workers).
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8');

  // -----------------------------------------------------------------------
  // Section: postMessage / reply helpers
  // -----------------------------------------------------------------------

  function post(msg, transfer) {
    if (transfer) {
      self.postMessage(msg, transfer);
    } else {
      self.postMessage(msg);
    }
  }

  /** Answer an RPC. `payload` is the result on ok, the error string otherwise. */
  function reply(id, ok, payload) {
    if (ok) {
      post({ type: 'rpc', id: id, ok: true, result: payload });
    } else {
      post({ type: 'rpc', id: id, ok: false, error: String(payload) });
    }
  }

  // -----------------------------------------------------------------------
  // Section: small utilities
  // -----------------------------------------------------------------------

  function lastLines(text, count) {
    const lines = String(text).split('\n');
    if (lines.length <= count) return lines.join('\n');
    return lines.slice(lines.length - count).join('\n');
  }

  /**
   * Convert a thrown error (JS or Python-via-PyProxy) into an RPC error
   * string. Python exceptions arrive with a full traceback in .message -
   * keep only the tail (the actual exception line).
   */
  function pyError(e) {
    const raw = e && typeof e.message === 'string' ? e.message : String(e);
    return lastLines(raw, OP_ERROR_TAIL);
  }

  function byteLen(s) {
    return textEncoder.encode(s).length;
  }

  // -----------------------------------------------------------------------
  // Section: sanitizers
  // -----------------------------------------------------------------------

  /** Workspace ids: [A-Za-z0-9_-]{1,64}. The main thread guarantees this;
   *  the worker re-validates. */
  function validWsId(id) {
    return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  }

  function requireWs(id) {
    if (!validWsId(id)) throw new Error('Invalid workspace id');
    return id;
  }

  function wsRoot(id) {
    return '/workspace/' + id;
  }

  /**
   * Workspace-relative path sanitizer (mirrors python _sanitize):
   * reject backslashes, absolute paths, '..' segments, disallowed ASCII
   * characters and (by default) empty results. '.' and '' segments are
   * normalized away. Unicode filenames pass through.
   */
  function sanitizeRel(p, allowEmpty) {
    if (typeof p !== 'string') throw new Error('path must be a string');
    if (p.length > MAX_PATH_LEN) throw new Error('path too long (max 512 chars)');
    if (p.indexOf('\\') !== -1) throw new Error('path must not contain backslashes');
    if (p.charAt(0) === '/') {
      throw new Error('path must be workspace-relative (absolute paths are rejected)');
    }
    const parts = [];
    const segments = p.split('/');
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') throw new Error("path must not contain '..' segments");
      for (let i = 0; i < seg.length; i++) {
        const ch = seg.charAt(i);
        if (ch.charCodeAt(0) < 128 && REL_ALLOWED.indexOf(ch) === -1) {
          throw new Error('disallowed character ' + JSON.stringify(ch) + ' in path');
        }
      }
      parts.push(seg);
    }
    const norm = parts.join('/');
    if (norm === '' && !allowEmpty) throw new Error('path must not be empty');
    return norm;
  }

  function requirePath(p) {
    if (typeof p !== 'string') throw new Error('path must be a string');
    return sanitizeRel(p, false);
  }

  // -----------------------------------------------------------------------
  // Section: exec output streaming
  // -----------------------------------------------------------------------

  /**
   * Route a batched stdout/stderr chunk from pyodide to the main thread.
   * Chunks are line-oriented: pyodide's batched callback fires per line and
   * may or may not include the trailing newline, so we normalize by appending
   * one when missing. Both kinds are captured into the same buffer (combined
   * output, arrival order). Everything stops at OUTPUT_STREAM_CAP with one
   * final truncation marker line.
   */
  function forwardStream(kind, text) {
    const ex = currentExec;
    if (!ex || ex.truncated) return; // no active exec (or already capped): drop
    let t = String(text);
    if (t.length > 0 && t.charCodeAt(t.length - 1) !== 10) t += '\n';
    const b = byteLen(t);
    if (ex.bytes + b > OUTPUT_STREAM_CAP) {
      ex.truncated = true;
      const marker = '... [output truncated]\n';
      ex.out.push(marker);
      post({ type: kind, execId: ex.id, text: marker });
      return;
    }
    ex.bytes += b;
    ex.out.push(t);
    post({ type: kind, execId: ex.id, text: t });
  }

  function beginExec(execId) {
    currentExec = { id: execId, out: [], bytes: 0, truncated: false };
  }

  function endExec() {
    const ex = currentExec;
    currentExec = null;
    return { text: ex ? ex.out.join('') : '', truncated: ex ? ex.truncated : false };
  }

  /**
   * Cap the combined exec output for the RPC result at 64 KB. When the
   * captured text is over the cap the TAIL is kept (final errors/summaries
   * are the useful part) behind a truncation marker.
   */
  function capResultOutput(s) {
    const bytes = textEncoder.encode(s);
    if (bytes.length <= OUTPUT_RESULT_CAP) return s;
    const marker = '... [output truncated]\n';
    let start = bytes.length - (OUTPUT_RESULT_CAP - marker.length);
    if (start < 0) start = 0;
    // Skip forward past any partial UTF-8 sequence so the decode is clean.
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
    return marker + textDecoder.decode(bytes.subarray(start));
  }

  function fsExists(pathStr) {
    try {
      self.pyodide.FS.stat(pathStr);
      return true;
    } catch (e) {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Section: bootstrap python (the 'rge' helper namespace)
  // -----------------------------------------------------------------------
  // One module defining pure functions the RPC ops call. Every function
  // returns a JSON string (the worker JSON.parse's it); errors are raised as
  // Python exceptions which pyodide converts to JS errors - the worker then
  // strips them to the last 3 traceback lines for the RPC error.
  //
  // NOTE: this is a String.raw template literal so Python escape sequences
  // (\n, \ufffd, ...) survive verbatim. The Python source must therefore
  // never contain a backtick or the sequence ${ .
  const BOOTSTRAP_PY = String.raw`import difflib
import fnmatch
import json
import os
import re
import runpy
import shutil
import sys
import time
import traceback
import types
import zipfile

# ---------------------------------------------------------------------------
# Path rules (must stay in sync with the worker's JS sanitizer)
# ---------------------------------------------------------------------------

_ALLOWED_CHARS = set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-/ ')
_WS_ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')


def _root_checked(root):
    """Validate a workspace root (/workspace/<id>) and return it."""
    root = str(root)
    if not root.startswith('/workspace/'):
        raise ValueError('invalid workspace root')
    wid = root[len('/workspace/'):]
    if not _WS_ID_RE.match(wid):
        raise ValueError('invalid workspace id')
    return root


def _sanitize(rel, allow_empty=False):
    """Validate + normalize a workspace-relative path.

    Rejects backslashes, absolute paths, '..' segments, disallowed ASCII
    characters and over-long paths. '.' and '' segments are normalized away.
    Unicode filenames are allowed.
    """
    if rel is None:
        rel = ''
    rel = str(rel)
    if len(rel) > 512:
        raise ValueError('path too long (max 512 chars)')
    if '\\' in rel:
        raise ValueError('path must not contain backslashes')
    if rel.startswith('/'):
        raise ValueError('path must be workspace-relative (no leading slash)')
    parts = []
    for seg in rel.split('/'):
        if seg == '' or seg == '.':
            continue
        if seg == '..':
            raise ValueError("path must not contain '..' segments")
        for ch in seg:
            if ord(ch) < 128 and ch not in _ALLOWED_CHARS:
                raise ValueError('disallowed character in path segment: ' + json.dumps(ch))
        parts.append(seg)
    norm = '/'.join(parts)
    if norm == '' and not allow_empty:
        raise ValueError('path must not be empty')
    return norm


def _walk(base, prefix, skip_dirs=()):
    """Deterministic (name-sorted) DFS generator over a directory tree.

    Yields (rel_path, abs_path, is_dir) tuples. rel_path is prefixed with
    'prefix' so callers can scope the walk to a subdirectory while still
    receiving workspace-relative paths.
    """
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return
    for name in names:
        ap = os.path.join(base, name)
        rp = prefix + '/' + name if prefix else name
        try:
            is_dir = os.path.isdir(ap)
        except OSError:
            continue
        yield (rp, ap, is_dir)
        if is_dir and name not in skip_dirs:
            for item in _walk(ap, rp, skip_dirs):
                yield item


def _node(rp, name, is_dir, st):
    """Build one ContainerFileNode dict."""
    return {
        'path': rp,
        'name': name,
        'dir': bool(is_dir),
        'size': 0 if is_dir else int(st.st_size),
        'mtime': int(st.st_mtime * 1000),
    }


# ---------------------------------------------------------------------------
# Workspace setup
# ---------------------------------------------------------------------------

def ensure(root):
    """Create the workspace root and its standard subdirectories."""
    r = _root_checked(root)
    os.makedirs(os.path.join(r, 'hub'), exist_ok=True)
    os.makedirs(os.path.join(r, 'extracted'), exist_ok=True)
    os.makedirs(os.path.join(r, 'output'), exist_ok=True)
    return json.dumps({'root': r})


# ---------------------------------------------------------------------------
# Listing / reading / writing
# ---------------------------------------------------------------------------

def list(root, rel=''):
    """Recursive listing with node/depth caps (800 nodes, depth 14)."""
    r = _root_checked(root)
    rel = _sanitize(rel, allow_empty=True)
    base = os.path.join(r, rel) if rel else r
    if not os.path.exists(base):
        raise FileNotFoundError('path not found: ' + (rel if rel else '.'))
    nodes = []
    if os.path.isfile(base):
        nodes.append(_node(rel, os.path.basename(rel), False, os.stat(base)))
        return json.dumps({'nodes': nodes})
    truncated = [False]

    def rec(p, pre, depth):
        try:
            names = sorted(os.listdir(p))
        except OSError:
            return
        for name in names:
            if len(nodes) >= 800:
                truncated[0] = True
                return
            ap = os.path.join(p, name)
            rp = pre + '/' + name if pre else name
            try:
                is_dir = os.path.isdir(ap)
                st = os.stat(ap)
            except OSError:
                continue
            nodes.append(_node(rp, name, is_dir, st))
            if is_dir:
                if depth + 1 >= 14:
                    # Depth cap: only flag truncation when the skipped
                    # directory is actually non-empty.
                    try:
                        if os.listdir(ap):
                            truncated[0] = True
                    except OSError:
                        truncated[0] = True
                else:
                    rec(ap, rp, depth + 1)

    rec(base, rel, 0)
    if truncated[0]:
        return json.dumps({'nodes': nodes, 'truncated': True})
    return json.dumps({'nodes': nodes})


def read(root, rel, maxb=None):
    """Read a file as UTF-8 text (capped), or flag it as binary."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    path = os.path.join(r, rel)
    if not os.path.isfile(path):
        raise FileNotFoundError('file not found: ' + rel)
    size = os.path.getsize(path)
    limit = 65536
    if maxb is not None:
        try:
            limit = int(maxb)
        except (TypeError, ValueError):
            limit = 65536
    if limit < 1:
        limit = 1
    if limit > 65536:
        limit = 65536
    with open(path, 'rb') as f:
        data = f.read()
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return json.dumps({'content': None, 'binary': True, 'size': size})
    if len(data) > limit:
        return json.dumps({
            'content': data[:limit].decode('utf-8', 'ignore'),
            'size': size,
            'truncated': True,
        })
    return json.dumps({'content': text, 'size': size})


def write(root, rel, content):
    """Write UTF-8 text, creating parent directories as needed."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    if content is None:
        content = ''
    content = str(content)
    path = os.path.join(r, rel)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    data = content.encode('utf-8')
    with open(path, 'wb') as f:
        f.write(data)
    return json.dumps({'path': rel, 'size': len(data)})


def _diff(filename, old, new):
    """Unified diff (context 3) mapped to ContainerDiffLine dicts.

    Returns (diff_dict, truncated_flag). File headers and hunk markers are
    dropped; the line list is capped at 400 entries.
    """
    a = old.splitlines()
    b = new.splitlines()
    lines = []
    adds = 0
    dels = 0
    truncated = False
    for ln in difflib.unified_diff(a, b, fromfile=filename, tofile=filename, lineterm='', n=3):
        if ln.startswith('---') or ln.startswith('+++') or ln.startswith('@@'):
            continue
        if len(lines) >= 400:
            truncated = True
            break
        if ln.startswith('+'):
            lines.append({'kind': 'added', 'text': ln[1:]})
            adds += 1
        elif ln.startswith('-'):
            lines.append({'kind': 'removed', 'text': ln[1:]})
            dels += 1
        else:
            body = ln[1:] if ln.startswith(' ') else ln
            lines.append({'kind': 'context', 'text': body})
    diff = {'filename': filename, 'additions': adds, 'deletions': dels, 'lines': lines}
    return diff, truncated


def edit(root, rel, find, replace, all_=False):
    """Mode A: replace first (or all) occurrences of 'find' with 'replace'."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    if find is None:
        raise ValueError('edit requires a find string')
    find = str(find)
    replace = '' if replace is None else str(replace)
    if find == '':
        raise ValueError('find string must not be empty')
    path = os.path.join(r, rel)
    if not os.path.isfile(path):
        raise FileNotFoundError('file not found: ' + rel)
    with open(path, 'rb') as f:
        data = f.read()
    try:
        old = data.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('cannot edit binary file: ' + rel)
    if find not in old:
        raise ValueError('find string not found in ' + rel)
    if all_:
        new = old.replace(find, replace)
        changed = old.count(find)
    else:
        new = old.replace(find, replace, 1)
        changed = 1
    d, dtrunc = _diff(rel, old, new)
    with open(path, 'wb') as f:
        f.write(new.encode('utf-8'))
    out = {'changed': changed, 'diff': d}
    if dtrunc:
        out['diffTruncated'] = True
    return json.dumps(out)


def rewrite(root, rel, content):
    """Mode B: full rewrite with a diff against the previous content.

    Creates the file (and parent directories) when it does not exist yet.
    'changed' is 1 when the content actually differs, 0 otherwise.
    """
    r = _root_checked(root)
    rel = _sanitize(rel)
    if content is None:
        content = ''
    content = str(content)
    path = os.path.join(r, rel)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    if os.path.isfile(path):
        with open(path, 'rb') as f:
            try:
                old = f.read().decode('utf-8')
            except UnicodeDecodeError:
                raise ValueError('cannot rewrite binary file as text: ' + rel)
    else:
        old = ''
    new = content
    d, dtrunc = _diff(rel, old, new)
    with open(path, 'wb') as f:
        f.write(new.encode('utf-8'))
    out = {'changed': 1 if new != old else 0, 'diff': d}
    if dtrunc:
        out['diffTruncated'] = True
    return json.dumps(out)


def delete(root, rel):
    """Remove a file or a whole directory tree."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    path = os.path.join(r, rel)
    if os.path.isdir(path):
        shutil.rmtree(path)
        return json.dumps({'deleted': True, 'dir': True})
    if os.path.isfile(path):
        os.remove(path)
        return json.dumps({'deleted': True, 'dir': False})
    raise FileNotFoundError('path not found: ' + rel)


def mkdir(root, rel):
    """mkdir -p for one workspace-relative path."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    os.makedirs(os.path.join(r, rel), exist_ok=True)
    return json.dumps({'path': rel})


# ---------------------------------------------------------------------------
# Zip helpers
# ---------------------------------------------------------------------------

def _extract_zip_abs(zpath, dest_abs):
    """Unzip zpath into dest_abs (overwriting), with zip-slip protection.

    Returns the list of extracted files: [{name, size}] (name relative to
    dest_abs). Absolute entries and entries containing '..' are skipped.
    """
    os.makedirs(dest_abs, exist_ok=True)
    files = []
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            name = info.filename.replace('\\', '/')
            while name.startswith('./'):
                name = name[2:]
            if name == '' or name == '/':
                continue
            if name.startswith('/') or re.match(r'^[A-Za-z]:', name):
                continue  # absolute entry - skip (zip slip guard)
            parts = name.split('/')
            if any(p == '..' for p in parts):
                continue  # traversal entry - skip (zip slip guard)
            if name.endswith('/'):
                # explicit directory entry
                os.makedirs(os.path.join(dest_abs, *[p for p in parts if p]), exist_ok=True)
                continue
            target = os.path.join(dest_abs, *parts)
            parent = os.path.dirname(target)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with zf.open(info) as src, open(target, 'wb') as out_f:
                shutil.copyfileobj(src, out_f)
            files.append({'name': name, 'size': int(info.file_size)})
    return files


def extract_zip(root, rel, dest=None):
    """Unzip a workspace zip. dest defaults to extracted/<basename-no-.zip>."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    zpath = os.path.join(r, rel)
    if not os.path.isfile(zpath):
        raise FileNotFoundError('zip not found: ' + rel)
    if dest is None or str(dest) == '':
        base = os.path.basename(rel)
        if base.lower().endswith('.zip') and len(base) > 4:
            base = base[:-4]
        if base == '':
            base = 'archive'
        dest = 'extracted/' + base
    dest = _sanitize(str(dest))
    files = _extract_zip_abs(zpath, os.path.join(r, dest))
    return json.dumps({'dest': dest, 'files': files, 'count': len(files)})


def create_zip(root, sources, dest):
    """Zip files/directories into dest (workspace-relative, ZIP_DEFLATED).

    Directories recurse in deterministic (name-sorted) order; archive entry
    names are the workspace-relative paths (like zip -r from the root).
    """
    r = _root_checked(root)
    dest = _sanitize(str(dest))
    if sources is None:
        srcs = []
    elif isinstance(sources, str):
        # Tolerate a JSON-encoded source list as well as a single path.
        try:
            parsed = json.loads(sources)
            srcs = [str(s) for s in parsed] if isinstance(parsed, list) else [sources]
        except ValueError:
            srcs = [sources]
    else:
        try:
            srcs = [str(s) for s in sources]
        except TypeError:
            srcs = []
    if not srcs:
        raise ValueError('createZip requires at least one source')
    dest_abs = os.path.join(r, dest)
    parent = os.path.dirname(dest_abs)
    if parent:
        os.makedirs(parent, exist_ok=True)
    count = 0
    with zipfile.ZipFile(dest_abs, 'w', zipfile.ZIP_DEFLATED) as zf:
        for s in srcs:
            srel = _sanitize(s)
            spath = os.path.join(r, srel)
            if os.path.isfile(spath):
                zf.write(spath, srel)
                count += 1
            elif os.path.isdir(spath):
                for (rp, ap, is_dir) in _walk(spath, srel):
                    if not is_dir:
                        zf.write(ap, rp)
                        count += 1
            else:
                raise FileNotFoundError('source not found: ' + srel)
    return json.dumps({'dest': dest, 'count': count, 'size': os.path.getsize(dest_abs)})


def zip_list(root, rel):
    """List the file entries of a workspace zip."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    zpath = os.path.join(r, rel)
    if not os.path.isfile(zpath):
        raise FileNotFoundError('zip not found: ' + rel)
    entries = []
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            entries.append({'name': info.filename, 'size': int(info.file_size)})
    return json.dumps({'entries': entries, 'count': len(entries)})


# ---------------------------------------------------------------------------
# Search / file info
# ---------------------------------------------------------------------------

def search(root, query, rel='', regex=False, maxr=None):
    """Line search under a path. Skips __pycache__ and binary files.

    Caps: maxResults (default 100, hard 500), 40 scanned files of at most
    512 KB each. Matched lines are capped at 400 chars.
    """
    r = _root_checked(root)
    rel = _sanitize(rel, allow_empty=True)
    base = os.path.join(r, rel) if rel else r
    if not os.path.isdir(base):
        raise FileNotFoundError('path not found: ' + (rel if rel else '.'))
    if query is None or str(query) == '':
        raise ValueError('search requires a query')
    query = str(query)
    max_results = 100
    if maxr is not None:
        try:
            max_results = int(maxr)
        except (TypeError, ValueError):
            max_results = 100
    if max_results < 1:
        max_results = 1
    if max_results > 500:
        max_results = 500
    pattern = None
    if regex:
        try:
            pattern = re.compile(query)
        except re.error as exc:
            raise ValueError('invalid regex: ' + str(exc))
    matches = []
    truncated = False
    files_scanned = 0
    for (rp, ap, is_dir) in _walk(base, rel, skip_dirs=('__pycache__',)):
        if is_dir:
            continue
        if files_scanned >= 40:
            truncated = True
            break
        try:
            if os.path.getsize(ap) > 512 * 1024:
                continue  # oversized file: skip without counting it
            with open(ap, 'rb') as f:
                data = f.read()
        except OSError:
            continue
        files_scanned += 1
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            continue  # binary file: skip
        for idx, line in enumerate(text.splitlines()):
            hit = pattern.search(line) if pattern is not None else (query in line)
            if hit:
                shown = line if len(line) <= 400 else line[:400] + '...'
                matches.append({'path': rp, 'line': idx + 1, 'text': shown})
                if len(matches) >= max_results:
                    truncated = True
                    break
        if truncated:
            break
    if truncated:
        return json.dumps({'matches': matches, 'truncated': True})
    return json.dumps({'matches': matches})


def info(root, rel):
    """Stat + text preview (first 4 KB) for one path."""
    r = _root_checked(root)
    rel = _sanitize(rel)
    path = os.path.join(r, rel)
    if not os.path.exists(path):
        raise FileNotFoundError('path not found: ' + rel)
    st = os.stat(path)
    is_dir = os.path.isdir(path)
    out = {
        'path': rel,
        'name': os.path.basename(rel),
        'dir': bool(is_dir),
        'size': int(st.st_size),
        'mtime': int(st.st_mtime * 1000),
    }
    if not is_dir:
        with open(path, 'rb') as f:
            head = f.read(4096)
        try:
            text = head.decode('utf-8')
        except UnicodeDecodeError:
            out['isText'] = False
        else:
            if '\ufffd' in text:
                out['isText'] = False
            else:
                out['isText'] = True
                out['preview'] = text
    return json.dumps(out)


# ---------------------------------------------------------------------------
# Mini terminal shell (rge.shell)
# ---------------------------------------------------------------------------
# A single entry point executing commands against the CURRENT WORKING
# DIRECTORY (the worker chdir's to the workspace root before exec). Output is
# streamed live via print() (which the worker routes through pyodide's
# setStdout/setStderr batched handlers). Returns the final exit code.
#
# Supported: python ls cat head tail rm cp mv mkdir unzip zip grep find wc
# echo tree stat pwd clear. Multiple commands may be joined with '&&'
# (execution stops at the first non-zero exit). Unknown command -> stderr
# 'rge-shell: command not found: X' + exit code 127.

def _out(s):
    print(s)


def _err(s):
    print(s, file=sys.stderr)


def _sh_resolve(p, allow_empty=False):
    """Resolve a cwd-relative shell path to an absolute MEMFS path."""
    rel = _sanitize(p, allow_empty=allow_empty)
    cwd = os.getcwd()
    if rel == '':
        return cwd
    return os.path.join(cwd, rel)


def _sh_python(args, rest):
    if not args:
        _err('python: missing file argument')
        return 2
    rel = args[0]
    path = _sh_resolve(rel)
    if not os.path.isfile(path):
        _err("python: can't open file '" + rel + "': No such file or directory")
        return 2
    old_argv = sys.argv
    try:
        sys.argv = [rel] + [str(a) for a in args[1:]]
        runpy.run_path(path, run_name='__main__')
        return 0
    except SystemExit as exc:
        code = exc.code
        if code is None:
            return 0
        if isinstance(code, int):
            return code
        _err(str(code))
        return 1
    except BaseException:
        _err(traceback.format_exc())
        return 1
    finally:
        sys.argv = old_argv


def _sh_ls(args, rest):
    target = args[0] if args else '.'
    path = _sh_resolve(target, allow_empty=True)
    if not os.path.exists(path):
        _err("ls: cannot access '" + target + "': No such file or directory")
        return 1
    if os.path.isfile(path):
        st = os.stat(path)
        _out('%s %10d %s' % ('-', st.st_size, os.path.basename(path)))
        return 0
    try:
        names = sorted(os.listdir(path))
    except OSError:
        return 0
    for n in names:
        ap = os.path.join(path, n)
        try:
            st = os.stat(ap)
            kind = 'd' if os.path.isdir(ap) else '-'
        except OSError:
            continue
        _out('%s %10d %s' % (kind, st.st_size, n))
    return 0


def _sh_cat(args, rest):
    if not args:
        _err('cat: missing file operand')
        return 2
    code = 0
    for rel in args:
        path = _sh_resolve(rel)
        if not os.path.isfile(path):
            _err('cat: ' + rel + ': No such file or directory')
            code = 1
            continue
        with open(path, 'rb') as f:
            text = f.read().decode('utf-8', 'replace')
        sys.stdout.write(text if text.endswith('\n') else text + '\n')
    return code


def _head_tail(args, tail):
    label = 'tail' if tail else 'head'
    n = 10
    files = [a for a in args]
    if files and files[0] == '-n':
        if len(files) < 2:
            _err(label + ': -n requires a number')
            return 2
        try:
            n = int(files[1])
        except ValueError:
            _err(label + ': invalid line count: ' + files[1])
            return 2
        files = files[2:]
    if not files:
        _err(label + ': missing file operand')
        return 2
    if n < 0:
        n = 0
    rel = files[0]
    path = _sh_resolve(rel)
    if not os.path.isfile(path):
        _err(label + ': ' + rel + ': No such file or directory')
        return 1
    with open(path, 'rb') as f:
        text = f.read().decode('utf-8', 'replace')
    lines = text.splitlines()
    if tail:
        picked = lines[-n:] if n > 0 else []
    else:
        picked = lines[:n]
    for ln in picked:
        _out(ln)
    return 0


def _sh_head(args, rest):
    return _head_tail(args, False)


def _sh_tail(args, rest):
    return _head_tail(args, True)


def _sh_rm(args, rest):
    recursive = False
    targets = []
    for a in args:
        if a.startswith('-') and a != '-':
            if 'r' in a[1:]:
                recursive = True
            continue  # other flags (-f ...) are accepted and ignored
        targets.append(a)
    if not targets:
        _err('rm: missing operand')
        return 2
    code = 0
    for rel in targets:
        path = _sh_resolve(rel)
        if os.path.isdir(path):
            if not recursive:
                _err("rm: cannot remove '" + rel + "': Is a directory")
                code = 1
                continue
            shutil.rmtree(path)
        elif os.path.isfile(path):
            os.remove(path)
        else:
            _err("rm: cannot remove '" + rel + "': No such file or directory")
            code = 1
    return code


def _sh_cp(args, rest):
    if len(args) != 2:
        _err('cp: usage: cp <src> <dst>')
        return 2
    src = _sh_resolve(args[0])
    dst = _sh_resolve(args[1])
    if not os.path.exists(src):
        _err("cp: cannot stat '" + args[0] + "': No such file or directory")
        return 1
    if os.path.isdir(src):
        shutil.copytree(src, dst, dirs_exist_ok=True)
    else:
        if os.path.isdir(dst):
            dst = os.path.join(dst, os.path.basename(src))
        parent = os.path.dirname(dst)
        if parent:
            os.makedirs(parent, exist_ok=True)
        shutil.copy2(src, dst)
    return 0


def _sh_mv(args, rest):
    if len(args) != 2:
        _err('mv: usage: mv <src> <dst>')
        return 2
    src = _sh_resolve(args[0])
    dst = _sh_resolve(args[1])
    if not os.path.exists(src):
        _err("mv: cannot stat '" + args[0] + "': No such file or directory")
        return 1
    if os.path.isdir(dst):
        dst = os.path.join(dst, os.path.basename(src))
    parent = os.path.dirname(dst)
    if parent:
        os.makedirs(parent, exist_ok=True)
    try:
        os.replace(src, dst)
    except OSError as exc:
        _err('mv: ' + str(exc))
        return 1
    return 0


def _sh_mkdir(args, rest):
    parents = False
    targets = []
    for a in args:
        if a.startswith('-') and a != '-':
            if 'p' in a[1:]:
                parents = True
            continue
        targets.append(a)
    if not targets:
        _err('mkdir: missing operand')
        return 2
    code = 0
    for rel in targets:
        path = _sh_resolve(rel)
        try:
            if parents:
                os.makedirs(path, exist_ok=True)
            else:
                os.mkdir(path)
        except FileExistsError:
            _err("mkdir: cannot create directory '" + rel + "': File exists")
            code = 1
        except OSError as exc:
            _err("mkdir: cannot create directory '" + rel + "': " + str(exc))
            code = 1
    return code


def _sh_unzip(args, rest):
    positional = []
    dest = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == '-d':
            i += 1
            if i >= len(args):
                _err('unzip: -d requires a destination path')
                return 2
            dest = args[i]
        elif a.startswith('-'):
            pass  # other flags accepted and ignored
        else:
            positional.append(a)
        i += 1
    if not positional:
        _err('unzip: usage: unzip <zip> [-d <dest>]')
        return 2
    zpath = _sh_resolve(positional[0])
    if not os.path.isfile(zpath):
        _err('unzip: cannot find ' + positional[0])
        return 1
    dest_abs = _sh_resolve(dest) if dest is not None else os.getcwd()
    try:
        files = _extract_zip_abs(zpath, dest_abs)
    except zipfile.BadZipFile:
        _err('unzip: ' + positional[0] + ': not a valid zip archive')
        return 1
    for f in files[:50]:
        _out('  inflating: ' + f['name'])
    if len(files) > 50:
        _out('  ... and ' + str(len(files) - 50) + ' more')
    _out(str(len(files)) + ' file(s) extracted')
    return 0


def _sh_zip(args, rest):
    positional = [a for a in args if not a.startswith('-')]  # -r implied
    if len(positional) < 2:
        _err('zip: usage: zip -r <out.zip> <src...>')
        return 2
    out_rel = positional[0]
    out_abs = _sh_resolve(out_rel)
    parent = os.path.dirname(out_abs)
    if parent:
        os.makedirs(parent, exist_ok=True)
    count = 0
    with zipfile.ZipFile(out_abs, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel in positional[1:]:
            spath = _sh_resolve(rel)
            if os.path.isfile(spath):
                zf.write(spath, rel)
                count += 1
            elif os.path.isdir(spath):
                for (rp, ap, is_dir) in _walk(spath, rel):
                    if not is_dir:
                        zf.write(ap, rp)
                        count += 1
            else:
                _err("zip: can't find: " + rel)
                return 1
    _out('  added ' + str(count) + ' file(s) to ' + out_rel)
    return 0


def _sh_grep(args, rest):
    ignore_case = False
    positional = []
    for a in args:
        if a.startswith('-') and a != '-':
            if 'i' in a[1:]:
                ignore_case = True
            continue
        positional.append(a)
    if not positional:
        _err('grep: usage: grep [-i] <pattern> [path]')
        return 2
    pattern = positional[0]
    target = positional[1] if len(positional) > 1 else '.'
    flags = re.IGNORECASE if ignore_case else 0
    try:
        rx = re.compile(pattern, flags)
    except re.error as exc:
        _err('grep: invalid pattern: ' + str(exc))
        return 2
    path = _sh_resolve(target, allow_empty=True)
    if os.path.isfile(path):
        pairs = [(target, path)]
        show_path = False
    elif os.path.isdir(path):
        prefix = _sanitize(target, allow_empty=True)
        pairs = [(rp, ap) for (rp, ap, is_dir) in _walk(path, prefix, skip_dirs=('__pycache__',)) if not is_dir]
        show_path = True
    else:
        _err('grep: ' + target + ': No such file or directory')
        return 1
    matches = 0
    for (rp, ap) in pairs:
        try:
            if os.path.getsize(ap) > 512 * 1024:
                continue
            with open(ap, 'rb') as f:
                text = f.read().decode('utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        for idx, line in enumerate(text.splitlines()):
            if rx.search(line):
                matches += 1
                shown = line if len(line) <= 400 else line[:400] + '...'
                if show_path:
                    _out(rp + ':' + str(idx + 1) + ':' + shown)
                else:
                    _out(str(idx + 1) + ':' + shown)
                if matches >= 500:
                    _out('... [grep output capped]')
                    return 0
    return 0 if matches > 0 else 1


def _sh_find(args, rest):
    target = '.'
    name_pattern = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == '-name':
            i += 1
            if i >= len(args):
                _err('find: -name requires a pattern')
                return 2
            name_pattern = args[i]
        elif a.startswith('-'):
            pass  # other flags accepted and ignored
        else:
            target = a
        i += 1
    path = _sh_resolve(target, allow_empty=True)
    if not os.path.exists(path):
        _err("find: '" + target + "': No such file or directory")
        return 1
    prefix = _sanitize(target, allow_empty=True)
    count = 0
    for (rp, ap, is_dir) in _walk(path, prefix):
        if name_pattern is not None and not fnmatch.fnmatch(os.path.basename(rp), name_pattern):
            continue
        _out(rp)
        count += 1
        if count >= 500:
            _out('... [find output capped]')
            break
    return 0


def _sh_wc(args, rest):
    if not args:
        _err('wc: missing file operand')
        return 2
    rel = args[0]
    path = _sh_resolve(rel)
    if not os.path.isfile(path):
        _err('wc: ' + rel + ': No such file or directory')
        return 1
    with open(path, 'rb') as f:
        data = f.read()
    text = data.decode('utf-8', 'replace')
    _out('%7d %7d %7d %s' % (len(text.splitlines()), len(text.split()), len(data), rel))
    return 0


def _sh_echo(args, rest):
    _out(rest.strip())
    return 0


def _sh_tree(args, rest):
    target = args[0] if args else '.'
    path = _sh_resolve(target, allow_empty=True)
    if not os.path.isdir(path):
        _err('tree: ' + target + ': Not a directory')
        return 1
    _out(target)
    count = [0]

    def rec(p, depth):
        if depth > 2:
            return
        try:
            names = sorted(os.listdir(p))
        except OSError:
            return
        for n in names:
            if count[0] >= 200:
                return
            ap = os.path.join(p, n)
            is_dir = os.path.isdir(ap)
            _out('  ' * depth + n + ('/' if is_dir else ''))
            count[0] += 1
            if count[0] >= 200:
                _out('... [tree output capped]')
                return
            if is_dir:
                rec(ap, depth + 1)

    rec(path, 1)
    return 0


def _sh_stat(args, rest):
    if not args:
        _err('stat: missing operand')
        return 2
    rel = args[0]
    path = _sh_resolve(rel)
    if not os.path.exists(path):
        _err("stat: cannot stat '" + rel + "': No such file or directory")
        return 1
    st = os.stat(path)
    kind = 'directory' if os.path.isdir(path) else 'file'
    _out('  File: ' + rel)
    _out('  Size: %-10d Type: %s' % (st.st_size, kind))
    _out('Modify: ' + time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime)))
    return 0


def _sh_pwd(args, rest):
    _out(os.getcwd())
    return 0


def _sh_clear(args, rest):
    return 0  # no-op: the UI clears itself


_SH_HANDLERS = {
    'python': _sh_python,
    'ls': _sh_ls,
    'cat': _sh_cat,
    'head': _sh_head,
    'tail': _sh_tail,
    'rm': _sh_rm,
    'cp': _sh_cp,
    'mv': _sh_mv,
    'mkdir': _sh_mkdir,
    'unzip': _sh_unzip,
    'zip': _sh_zip,
    'grep': _sh_grep,
    'find': _sh_find,
    'wc': _sh_wc,
    'echo': _sh_echo,
    'tree': _sh_tree,
    'stat': _sh_stat,
    'pwd': _sh_pwd,
    'clear': _sh_clear,
}


def _sh_run(line):
    m = re.match(r'^(\S+)\s*(.*)$', line, re.S)
    if not m:
        return 0
    name = m.group(1)
    rest = m.group(2) or ''
    args = rest.split()
    fn = _SH_HANDLERS.get(name)
    if fn is None:
        _err('rge-shell: command not found: ' + name)
        return 127
    try:
        return fn(args, rest)
    except Exception as exc:
        _err(name + ': ' + str(exc))
        return 1


def shell(cmd):
    """Execute one shell command line (may contain '&&' chains).

    Prints output via print() (streamed live by the worker) and returns the
    final exit code as an int.
    """
    cmd = '' if cmd is None else str(cmd)
    cmd = cmd.strip()
    if cmd == '':
        return 0
    for chunk in cmd.split('&&'):
        chunk = chunk.strip()
        if chunk == '':
            continue
        code = _sh_run(chunk)
        if code != 0:
            return code
    return 0


# ---------------------------------------------------------------------------
# Publish the 'rge' namespace (the worker grabs it via
# pyodide.globals.get('rge')).
# ---------------------------------------------------------------------------

_rge = types.ModuleType('rge')
_rge.__dict__.update({
    'ensure': ensure,
    'list': list,
    'read': read,
    'write': write,
    'edit': edit,
    'rewrite': rewrite,
    'delete': delete,
    'mkdir': mkdir,
    'extract_zip': extract_zip,
    'create_zip': create_zip,
    'zip_list': zip_list,
    'search': search,
    'info': info,
    'shell': shell,
    '_sanitize': _sanitize,
    '_walk': _walk,
})
sys.modules['rge'] = _rge
rge = _rge
`;

  // -----------------------------------------------------------------------
  // Section: boot
  // -----------------------------------------------------------------------

  /**
   * Load pyodide + the bootstrap module. Resolves when the worker is ready
   * to serve RPCs, rejects with the boot failure. NOTE: importScripts() is
   * the first statement so it runs synchronously inside the message task
   * that triggered the boot (no async-importScripts browser quirks).
   */
  async function bootStarted() {
    importScripts(PYODIDE_BASE + 'pyodide.js');
    if (typeof self.loadPyodide !== 'function') {
      throw new Error('pyodide.js did not define loadPyodide');
    }
    self.pyodide = await self.loadPyodide({ indexURL: PYODIDE_BASE });
    // Route interpreter output to the active exec (if any). These handlers
    // are installed once and live for the worker's whole lifetime.
    self.pyodide.setStdout({ batched: function (t) { forwardStream('stdout', t); } });
    self.pyodide.setStderr({ batched: function (t) { forwardStream('stderr', t); } });
    await self.pyodide.runPythonAsync(BOOTSTRAP_PY);
    self.rge = self.pyodide.globals.get('rge');
    if (!self.rge) {
      throw new Error('bootstrap did not define the rge namespace');
    }
  }

  /**
   * Lazy boot: called from the message handler on the FIRST rpc. RPCs that
   * keep arriving during the boot are queued and drained in order once
   * ready. On failure the worker stays dead (state 'error') and every queued
   * RPC gets an error reply.
   */
  function boot() {
    if (state !== 'idle') return;
    state = 'booting';
    bootStarted()
      .then(function () {
        state = 'ready';
        post({ type: 'ready' });
        // Drain the boot queue strictly in arrival order. dispatchRpc never
        // rejects (every error becomes an rpc reply), so this fire-and-forget
        // loop cannot die halfway.
        const queue = bootQueue.splice(0);
        (async function () {
          for (let i = 0; i < queue.length; i++) {
            await dispatchRpc(queue[i]);
          }
        })();
      })
      .catch(function (e) {
        state = 'error';
        const message = e && typeof e.message === 'string' ? e.message : String(e);
        post({ type: 'boot-error', message: message });
        const queue = bootQueue.splice(0);
        for (let i = 0; i < queue.length; i++) {
          reply(queue[i].id, false, 'Container failed to boot: ' + message);
        }
      });
  }

  // -----------------------------------------------------------------------
  // Section: message entry point
  // -----------------------------------------------------------------------

  self.onmessage = function (ev) {
    let msg = null;
    try {
      msg = ev.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type !== 'rpc') return; // only RPC traffic is defined
      if (typeof msg.id !== 'number' || typeof msg.op !== 'string') return; // cannot even reply
      if (state === 'idle') {
        // First RPC: queue it and start the lazy boot.
        bootQueue.push(msg);
        boot();
        return;
      }
      if (state === 'booting') {
        bootQueue.push(msg);
        return;
      }
      if (state === 'error') {
        reply(msg.id, false, 'Container failed to boot');
        return;
      }
      // state === 'ready'
      dispatchRpc(msg).catch(function () {
        // dispatchRpc never rejects; this is pure belt-and-braces.
      });
    } catch (e) {
      // Absolute last resort - a bug must never kill the worker.
      try {
        if (msg && typeof msg.id === 'number') {
          reply(msg.id, false, 'worker error: ' + ((e && e.message) || String(e)));
        }
      } catch (e2) {
        // nothing left to do
      }
    }
  };

  // -----------------------------------------------------------------------
  // Section: RPC dispatch
  // -----------------------------------------------------------------------

  async function dispatchRpc(msg) {
    const id = msg.id;
    try {
      // readBytes is special: its result is an ArrayBuffer that must be
      // TRANSFERRED back to the main thread.
      if (msg.op === 'readBytes') {
        const buf = opReadBytes(msg.args || {});
        post({ type: 'rpc', id: id, ok: true, result: buf }, [buf]);
        return;
      }
      // Execs manage their own reply ordering:
      //   rpc reply -> exec-end -> fs('*') event.
      if (msg.op === 'execCode' || msg.op === 'execCommand') {
        await runExec(id, msg.op, msg.args || {});
        return;
      }
      const out = await runOp(msg.op, msg.args || {});
      reply(id, true, out.result);
      if (out.fsPaths) {
        post({ type: 'fs', workspace: out.wsId, paths: out.fsPaths });
      }
    } catch (e) {
      reply(id, false, pyError(e));
    }
  }

  /** Wrap a plain result (no fs event). */
  function plain(result) {
    return { result: result };
  }

  /** Wrap a result + the fs event to emit after the reply. */
  function withFs(wsId, fsPaths, result) {
    return { result: result, wsId: wsId, fsPaths: fsPaths };
  }

  // -----------------------------------------------------------------------
  // Section: op implementations (non-exec)
  // -----------------------------------------------------------------------

  async function runOp(op, args) {
    switch (op) {
      // Internal: the client sends a ping as the FIRST rpc purely to trigger
      // the lazy boot; its reply is ignored by the client.
      case 'ping':
        return plain({ pong: true });

      case 'ensureWorkspace': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        JSON.parse(self.rge.ensure(root)); // creates root + hub/ extracted/ output/
        return plain({ root: root });
      }

      case 'list': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = typeof args.path === 'string' && args.path !== '' ? args.path : '';
        return plain(JSON.parse(self.rge.list(root, rel)));
      }

      case 'read': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        let maxb = null;
        if (typeof args.maxBytes === 'number' && isFinite(args.maxBytes)) {
          maxb = args.maxBytes;
        }
        return plain(JSON.parse(self.rge.read(root, rel, maxb)));
      }

      case 'write': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        if (typeof args.content !== 'string') {
          throw new Error('write requires content to be a string');
        }
        const res = JSON.parse(self.rge.write(root, rel, args.content));
        return withFs(wsId, [{ path: rel, dir: false }], res);
      }

      case 'writeBytes': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        let u8 = null;
        if (args.bytes instanceof ArrayBuffer) {
          u8 = new Uint8Array(args.bytes);
        } else if (args.bytes && typeof args.bytes === 'object' && typeof args.bytes.buffer === 'object') {
          // Tolerate a typed-array view as well.
          const view = args.bytes;
          u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        } else {
          throw new Error('writeBytes requires bytes to be an ArrayBuffer');
        }
        // mkdir -p parents via the python helper (idempotent), then write.
        const slash = rel.lastIndexOf('/');
        if (slash > 0) {
          JSON.parse(self.rge.mkdir(root, rel.slice(0, slash)));
        }
        self.pyodide.FS.writeFile(root + '/' + rel, u8);
        return withFs(wsId, [{ path: rel, dir: false }], { path: rel, size: u8.byteLength });
      }

      case 'edit': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        if (args.find !== undefined && args.find !== null) {
          if (typeof args.find !== 'string') throw new Error('find must be a string');
          const replace = typeof args.replace === 'string' ? args.replace : '';
          const res = JSON.parse(self.rge.edit(root, rel, args.find, replace, args.all === true));
          return withFs(wsId, [{ path: rel, dir: false }], res);
        }
        if (typeof args.content === 'string') {
          const res = JSON.parse(self.rge.rewrite(root, rel, args.content));
          return withFs(wsId, [{ path: rel, dir: false }], res);
        }
        throw new Error('edit requires find or content');
      }

      case 'delete': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        const res = JSON.parse(self.rge.delete(root, rel));
        return withFs(wsId, [{ path: rel, dir: res.dir === true }], res);
      }

      case 'mkdir': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const res = JSON.parse(self.rge.mkdir(root, requirePath(args.path)));
        return withFs(wsId, [{ path: res.path, dir: true }], res);
      }

      case 'extractZip': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        const rel = requirePath(args.path);
        const dest = typeof args.dest === 'string' && args.dest !== '' ? args.dest : null;
        try {
          const res = JSON.parse(self.rge.extract_zip(root, rel, dest));
          return withFs(wsId, [{ path: '*', dir: true }], res);
        } catch (e) {
          // A failed unzip may still have written partial files: ask the
          // main thread for a full refresh, then surface the error.
          post({ type: 'fs', workspace: wsId, paths: [{ path: '*', dir: true }] });
          throw e;
        }
      }

      case 'createZip': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        if (!Array.isArray(args.sources) || args.sources.length === 0) {
          throw new Error('createZip requires a non-empty sources array');
        }
        for (let i = 0; i < args.sources.length; i++) {
          requirePath(args.sources[i]); // validate every source up front
        }
        const dest = requirePath(args.dest);
        try {
          const res = JSON.parse(self.rge.create_zip(root, args.sources, dest));
          return withFs(wsId, [{ path: '*', dir: true }], res);
        } catch (e) {
          post({ type: 'fs', workspace: wsId, paths: [{ path: '*', dir: true }] });
          throw e;
        }
      }

      case 'zipList': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        return plain(JSON.parse(self.rge.zip_list(root, requirePath(args.path))));
      }

      case 'search': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        if (typeof args.query !== 'string' || args.query === '') {
          throw new Error('search requires a non-empty query');
        }
        const rel = typeof args.path === 'string' && args.path !== '' ? args.path : '';
        let maxr = null;
        if (typeof args.maxResults === 'number' && isFinite(args.maxResults)) {
          maxr = args.maxResults;
        }
        return plain(JSON.parse(self.rge.search(root, args.query, rel, args.regex === true, maxr)));
      }

      case 'fileInfo': {
        const wsId = requireWs(args.workspaceId);
        const root = wsRoot(wsId);
        return plain(JSON.parse(self.rge.info(root, requirePath(args.path))));
      }

      default:
        throw new Error('Unknown op');
    }
  }

  /** readBytes: raw file bytes transferred back to the main thread. */
  function opReadBytes(args) {
    const root = wsRoot(requireWs(args.workspaceId));
    const rel = requirePath(args.path);
    const abs = root + '/' + rel;
    if (!fsExists(abs)) throw new Error('file not found: ' + rel);
    const data = self.pyodide.FS.readFile(abs);
    // FS.readFile may return a view into wasm-owned memory - always copy
    // into a standalone ArrayBuffer before transferring it.
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  // -----------------------------------------------------------------------
  // Section: exec ops (execCode / execCommand)
  // -----------------------------------------------------------------------

  async function runExec(id, op, args) {
    const wsId = requireWs(args.workspaceId);
    const root = wsRoot(wsId);
    if (typeof args.execId !== 'string' || args.execId === '') {
      throw new Error('exec requires an execId');
    }
    // One exec at a time (the client chains execs anyway; this is the guard).
    if (currentExec) {
      reply(id, false, 'Container busy - one execution at a time.');
      return;
    }
    const execId = args.execId;
    const started = Date.now();
    beginExec(execId);

    let ok = true;
    let exitCode = 0;
    let error = null;

    try {
      // Make sure the workspace exists, then run with cwd = workspace root.
      // File writes by executed python code land in the same MEMFS
      // naturally; the '*' fs event below covers their discovery.
      self.rge.ensure(root);
      self.pyodide.FS.chdir(root);

      if (op === 'execCode') {
        if (typeof args.code === 'string' && args.code.length > 0) {
          await self.pyodide.runPythonAsync(args.code);
        } else if (typeof args.file === 'string' && args.file !== '') {
          const rel = requirePath(args.file);
          const abs = root + '/' + rel;
          if (!fsExists(abs)) throw new Error('file not found: ' + rel);
          // Run the file as __main__ via runpy so its prints stream through
          // the setStdout handler live.
          const runner =
            'import runpy, sys\n' +
            'sys.argv = ' + JSON.stringify([rel]) + '\n' +
            'runpy.run_path(' + JSON.stringify(abs) + ', run_name="__main__")';
          await self.pyodide.runPythonAsync(runner);
        } else {
          throw new Error('execCode requires code or file');
        }
      } else {
        // execCommand: the mini shell implemented in python.
        if (typeof args.command !== 'string' || args.command.trim() === '') {
          throw new Error('execCommand requires a command string');
        }
        exitCode = self.rge.shell(args.command);
        if (typeof exitCode !== 'number') exitCode = 1;
        if (exitCode !== 0) {
          ok = false;
          error = 'exit code ' + exitCode;
        }
      }
    } catch (e) {
      const raw = e && typeof e.message === 'string' ? e.message : String(e);
      const lines = raw.trim().split('\n');
      const last = lines[lines.length - 1] || '';
      if (op === 'execCode' && /^SystemExit\b/.test(last)) {
        // Python called sys.exit(): a clean finish, not an error.
        const m = /SystemExit:?\s*(-?\d+)/.exec(last);
        exitCode = m ? parseInt(m[1], 10) : 0;
        ok = exitCode === 0;
        error = ok ? null : 'exit code ' + exitCode;
      } else {
        ok = false;
        if (exitCode === 0) exitCode = 1;
        error = lastLines(raw, TRACEBACK_TAIL);
      }
    }

    const captured = endExec();
    const result = {
      ok: ok,
      exitCode: exitCode,
      output: capResultOutput(captured.text),
    };
    if (error !== null) result.error = error;
    result.durationMs = Date.now() - started;

    // Order matters: the client stashes the rpc result and resolves the
    // exec promise when exec-end arrives, then refreshes on the fs event.
    reply(id, true, result);
    const endMsg = { type: 'exec-end', execId: execId, ok: ok };
    if (!ok && error !== null) endMsg.error = error;
    endMsg.durationMs = result.durationMs;
    post(endMsg);
    post({ type: 'fs', workspace: wsId, paths: [{ path: '*', dir: true }] });
  }
})();
