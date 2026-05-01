import React from 'react';

interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  showScore?: boolean;
}

const getColor = (score: number) => {
  if (score >= 90) return '#10b981';
  if (score >= 70) return '#f59e0b';
  if (score >= 50) return '#f97316';
  return '#ef4444';
};

const ScoreRing: React.FC<ScoreRingProps> = ({
  score,
  size = 100,
  strokeWidth = 8,
  label,
  showScore = true,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  const color = getColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#f1f5f9" strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        {showScore && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-black text-slate-900 leading-none" style={{ fontSize: size * 0.22 }}>
              {score}
            </span>
            <span className="font-bold text-slate-400" style={{ fontSize: size * 0.1 }}>
              /100
            </span>
          </div>
        )}
      </div>
      {label && (
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider text-center leading-tight">
          {label}
        </span>
      )}
    </div>
  );
};

export default ScoreRing;
