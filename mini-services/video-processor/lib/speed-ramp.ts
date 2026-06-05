/**
 * Speed Ramp Math and Logic
 * 
 * Provides mathematical functions for calculating speed ramping curves,
 * output durations, and generating data points for visualization.
 */

export interface SpeedCurvePoint {
  time: number;
  speed: number;
  outputTime: number;
}

export interface SpeedRampConfig {
  startSpeed: number;
  endSpeed: number;
  duration: number;
}

/**
 * Calculate speed at a given time t for a linear speed ramp.
 * Speed function: S(t) = startSpeed + (endSpeed - startSpeed) * (t / D)
 */
export function speedAtTime(
  startSpeed: number,
  endSpeed: number,
  duration: number,
  t: number
): number {
  return startSpeed + (endSpeed - startSpeed) * (t / duration);
}

/**
 * Calculate the output duration after applying speed ramping.
 * 
 * For a linear speed ramp, the output duration is calculated using
 * logarithmic integration:
 * 
 * T_out = (D / (endSpeed - startSpeed)) * ln(endSpeed / startSpeed)
 * 
 * This integrates the reciprocal of the speed function over the input duration.
 */
export function calculateOutputDuration(
  startSpeed: number,
  endSpeed: number,
  inputDuration: number
): number {
  if (Math.abs(endSpeed - startSpeed) < 1e-6) {
    // Constant speed: output duration = input duration / speed
    return inputDuration / startSpeed;
  }
  // T_out = (D / (v2 - v1)) * ln(v2 / v1)
  return (inputDuration / (endSpeed - startSpeed)) * Math.log(endSpeed / startSpeed);
}

/**
 * Generate speed curve data points for visualization.
 * 
 * Creates an array of points showing how speed changes over time,
 * along with the corresponding output time for each point.
 * 
 * @param startSpeed - Starting speed multiplier
 * @param endSpeed - Ending speed multiplier
 * @param duration - Input clip duration in seconds
 * @param points - Number of data points to generate
 * @returns Array of speed curve points
 */
export function calculateSpeedCurve(
  startSpeed: number,
  endSpeed: number,
  duration: number,
  points: number = 50
): SpeedCurvePoint[] {
  const result: SpeedCurvePoint[] = [];
  const dt = duration / (points - 1);

  // Calculate cumulative output time using numerical integration
  let cumulativeOutputTime = 0;

  for (let i = 0; i < points; i++) {
    const t = i * dt;
    const speed = speedAtTime(startSpeed, endSpeed, duration, t);

    if (i > 0) {
      // Trapezoidal integration for output time
      const prevSpeed = speedAtTime(startSpeed, endSpeed, duration, (i - 1) * dt);
      const avgSpeed = (prevSpeed + speed) / 2;
      cumulativeOutputTime += dt / avgSpeed;
    }

    result.push({
      time: t,
      speed,
      outputTime: cumulativeOutputTime,
    });
  }

  return result;
}

/**
 * Validate that speed ramp parameters are within acceptable ranges.
 */
export function validateSpeedRampParams(
  startSpeed: number,
  endSpeed: number,
  duration: number
): { valid: boolean; error?: string } {
  if (startSpeed <= 0 || endSpeed <= 0) {
    return { valid: false, error: "Speed values must be positive" };
  }
  if (duration <= 0) {
    return { valid: false, error: "Duration must be positive" };
  }
  if (startSpeed > 100 || endSpeed > 100) {
    return { valid: false, error: "Speed values must be <= 100" };
  }
  if (startSpeed < 0.1 || endSpeed < 0.1) {
    return { valid: false, error: "Speed values must be >= 0.1" };
  }
  return { valid: true };
}

/**
 * Generate the FFmpeg setpts expression for a linear speed ramp.
 * 
 * For speed function S(t) = v1 + (v2 - v1) * (t / D):
 * 
 * The setpts mapping (for changing presentation timestamps) is:
 * new_pts = (D / (v2 - v1)) / TB * ln((v1 + (v2 - v1) * PTS * TB / D) / v1)
 * 
 * Simplified for FFmpeg expression syntax:
 * setpts='(D/(v2-v1)/TB)*ln((v1+(v2-v1)*PTS*TB/D)/v1)'
 */
export function generateSetptsExpression(
  startSpeed: number,
  endSpeed: number,
  duration: number
): string {
  const D = duration;
  const v1 = startSpeed;
  const diff = endSpeed - startSpeed;

  if (Math.abs(diff) < 1e-6) {
    // Constant speed
    return `PTS/${v1}`;
  }

  // FFmpeg uses 'log' for natural logarithm in expression evaluator
  // setpts='(D/diff/TB)*log((v1+diff*PTS*TB/D)/v1)'
  return `(${D}/${diff}/TB)*log((${v1}+${diff}*PTS*TB/${D})/${v1})`;
}

/**
 * Generate the FFmpeg setpts expression for a reverse speed ramp.
 * 
 * For reverse ramp (high speed → low speed), the speed function is:
 * S(t) = v2 + (v1 - v2) * (t / D) = v2 - diff * (t / D)
 * where diff = v2 - v1 (the original direction's diff)
 * 
 * But since we're going from endSpeed to startSpeed:
 * S(t) = endSpeed + (startSpeed - endSpeed) * (t / D)
 * 
 * The setpts mapping becomes:
 * setpts='(D/diff/TB)*ln(endSpeed/(endSpeed-diff*PTS*TB/D))'
 * where diff = endSpeed - startSpeed
 */
export function generateReverseSetptsExpression(
  startSpeed: number,
  endSpeed: number,
  duration: number
): string {
  const D = duration;
  const v2 = endSpeed;
  const diff = endSpeed - startSpeed;

  if (Math.abs(diff) < 1e-6) {
    // Constant speed
    return `PTS/${endSpeed}`;
  }

  // FFmpeg uses 'log' for natural logarithm in expression evaluator
  // setpts='(D/diff/TB)*log(v2/(v2-diff*PTS*TB/D))'
  return `(${D}/${diff}/TB)*log(${v2}/(${v2}-${diff}*PTS*TB/${D}))`;
}
