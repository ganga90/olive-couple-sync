import React from 'react';

interface SettingsSectionHeaderProps {
  title: string;
  className?: string;
}

export const SettingsSectionHeader: React.FC<SettingsSectionHeaderProps> = ({ 
  title, 
  className = '' 
}) => {
  return (
    <h2 className={`text-xs font-bold uppercase tracking-widest text-stone-500 mb-4 ${className}`}>
      {title}
    </h2>
  );
};

export default SettingsSectionHeader;
