import React from "react";
import oliveLogoImage from "@/assets/olive-logo.jpg";
export const OliveLogo: React.FC<{
  size?: number;
  className?: string;
}> = ({
  size = 32,
  className = ""
}) => {
  return <div className={`inline-flex items-center justify-center ${className}`}>
      
    </div>;
};
export const OliveLogoWithText: React.FC<{
  size?: "sm" | "md" | "lg";
  className?: string;
}> = ({
  size = "md",
  className = ""
}) => {
  const logoSize = size === "sm" ? 24 : size === "lg" ? 48 : 32;
  const textSize = size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-2xl";
  return <div className={`flex items-center gap-3 ${className}`}>
      <OliveLogo size={logoSize} />
      <span className={`font-bold text-primary ${textSize} tracking-tight`}>
        Olive
      </span>
    </div>;
};