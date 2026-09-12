'use client';

import React from 'react';
import type { Resource } from '@/lib/resources';
import { FileCode, Film, Image as ImageIcon, Download, Eye, Crown } from 'lucide-react';

interface ResourceCardProps {
  resource: Resource;
  onClick?: () => void;
  onDownload?: () => void;
  showOwner?: boolean;
}

export function ResourceCard({ resource, onClick, onDownload, showOwner = true }: ResourceCardProps) {
  const typeIcon = resource.type === 'image' ? ImageIcon : resource.type === 'clip' ? Film : FileCode;
  const TypeIcon = typeIcon;
  // Red Noir: all type icons use the same red accent
  const typeColor = 'text-[#ef233c]';

  const isAdminResource = resource.ownerName?.toLowerCase() === 'railguyedits' || resource.xmlSource === 'admin';

  return (
    <div
      onClick={onClick}
      className="group rounded-xl border border-white/10 bg-black/60 backdrop-blur-xl overflow-hidden hover:border-[#ef233c]/30 hover:bg-black/80 hover:-translate-y-1 transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] cursor-pointer"
    >
      {/* Preview — supports full-size images with any aspect ratio */}
      <div className="relative bg-black/40 overflow-hidden" style={{ minHeight: '120px', maxHeight: '280px' }}>
        {resource.thumbnailUrl || resource.downloadUrl ? (
          <img
            src={resource.thumbnailUrl || resource.downloadUrl}
            alt={resource.title}
            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ maxHeight: '280px' }}
            loading="lazy"
          />
        ) : resource.type === 'xml' ? (
          <div className="w-full h-full flex items-center justify-center" style={{ minHeight: '160px' }}>
            <FileCode className="w-10 h-10 text-[#ef233c]/30" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ minHeight: '160px' }}>
            <TypeIcon className={`w-10 h-10 ${typeColor} opacity-30`} />
          </div>
        )}

        {/* Type badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10">
          <TypeIcon className={`w-3 h-3 ${typeColor}`} />
          <span className="text-[9px] font-manrope uppercase tracking-wider text-zinc-300">{resource.type}</span>
        </div>

        {/* Admin badge */}
        {isAdminResource && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#ef233c]/20 backdrop-blur-sm border border-[#ef233c]/30">
            <Crown className="w-3 h-3 text-[#ef233c]" />
            <span className="text-[9px] font-manrope uppercase tracking-wider text-[#ef233c]">Admin</span>
          </div>
        )}

        {/* Duration for clips */}
        {resource.type === 'clip' && resource.duration && (
          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-manrope text-white">
            {resource.duration.toFixed(1)}s
          </div>
        )}

        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center gap-2">
          {onClick && (
            <button className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center hover:bg-white/20 transition-all">
              <Eye className="w-4 h-4 text-white" />
            </button>
          )}
          {onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="w-10 h-10 rounded-full bg-[#ef233c]/30 backdrop-blur-sm border border-[#ef233c]/40 flex items-center justify-center hover:bg-[#ef233c]/50 transition-all"
            >
              <Download className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-manrope text-sm font-medium text-white truncate mb-1">{resource.title}</h3>
        {showOwner && (
          <p className="text-[11px] font-inter text-zinc-500 mb-2">
            by <span className={isAdminResource ? 'text-[#ef233c]' : 'text-zinc-400'}>{resource.ownerName}</span>
          </p>
        )}
        {resource.tags && resource.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {resource.tags.slice(0, 3).map((tag, i) => (
              <span key={i} className="text-[9px] font-manrope px-1.5 py-0.5 rounded-md bg-white/[0.03] border border-white/5 text-zinc-500">
                {tag}
              </span>
            ))}
            {resource.tags.length > 3 && (
              <span className="text-[9px] font-manrope text-zinc-600">+{resource.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
