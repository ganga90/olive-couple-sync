import React from "react";

export const OliveLogo: React.FC<{ size?: number; className?: string }> = ({ 
  size = 32, 
  className = "" 
}) => {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer arc - Deep Olive Green */}
        <path
          d="M 40 60 A 60 60 0 0 1 160 60"
          stroke="#2C5E3D"
          strokeWidth="12"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Inner arc - Warm Gold */}
        <path
          d="M 70 85 A 30 30 0 0 1 130 85"
          stroke="#B8933D"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        
        {/* Blue dot */}
        <circle
          cx="100"
          cy="50"
          r="6"
          fill="#3B82F6"
        />
        
        {/* Left leaf - Deep Olive Green */}
        <path
          d="M 100 110 Q 50 120, 40 170 Q 35 185, 50 195 Q 65 200, 85 185 Q 100 170, 100 140 Z"
          fill="#2C5E3D"
        />
        
        {/* Right leaf - Deep Olive Green */}
        <path
          d="M 100 110 Q 150 120, 160 170 Q 165 185, 150 195 Q 135 200, 115 185 Q 100 170, 100 140 Z"
          fill="#2C5E3D"
        />
      </svg>
    </div>
  );
};

export const OliveLogoWithText: React.FC<{ size?: "sm" | "md" | "lg"; className?: string }> = ({ 
  size = "md", 
  className = "" 
}) => {
  const logoSize = size === "sm" ? 24 : size === "lg" ? 48 : 32;
  const textSize = size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-2xl";
  
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <OliveLogo size={logoSize} />
      <span className={`font-bold text-primary ${textSize} tracking-tight`}>
        Olive
      </span>
    </div>
  );
};