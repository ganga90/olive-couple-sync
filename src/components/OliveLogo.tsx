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
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-sm"
      >
        {/* Olive gradient definition */}
        <defs>
          <linearGradient id="oliveGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(75, 35%, 45%)" />
            <stop offset="100%" stopColor="hsl(85, 40%, 55%)" />
          </linearGradient>
          <linearGradient id="leafGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(85, 40%, 65%)" />
            <stop offset="100%" stopColor="hsl(95, 35%, 55%)" />
          </linearGradient>
        </defs>
        
        {/* Main olive body */}
        <ellipse
          cx="16"
          cy="18"
          rx="7"
          ry="11"
          fill="url(#oliveGradient)"
          className="drop-shadow-sm"
        />
        
        {/* Small leaf */}
        <path
          d="M20 10 C22 8, 26 8, 26 12 C26 14, 24 16, 20 14 Z"
          fill="url(#leafGradient)"
          className="drop-shadow-sm"
        />
        
        {/* Highlight on olive */}
        <ellipse
          cx="13"
          cy="14"
          rx="2"
          ry="3"
          fill="hsl(75, 50%, 70%)"
          opacity="0.6"
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