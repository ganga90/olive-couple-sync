import React from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LANGUAGES } from '@/lib/i18n/languages';
import { useLanguage } from '@/providers/LanguageProvider';

interface LanguageSwitcherProps {
  compact?: boolean;
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ 
  compact = false,
  className = '' 
}) => {
  const { t } = useTranslation('common');
  const { currentLanguage, changeLanguage, isLoading } = useLanguage();

  const handleChange = async (value: string) => {
    await changeLanguage(value);
  };

  if (compact) {
    return (
      <Select value={currentLanguage} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className={`w-[60px] h-9 ${className}`}>
          <span className="text-lg">{LANGUAGES[currentLanguage]?.flag}</span>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LANGUAGES).map(([code, lang]) => (
            <SelectItem key={code} value={code}>
              <span className="flex items-center gap-2">
                <span className="text-lg">{lang.flag}</span>
                <span>{lang.nativeName}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <label className="text-sm font-medium text-foreground flex items-center gap-2">
        <Globe className="h-4 w-4" />
        {t('language.title')}
      </label>
      <Select value={currentLanguage} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className="w-full">
          <SelectValue>
            <span className="flex items-center gap-2">
              <span className="text-lg">{LANGUAGES[currentLanguage]?.flag}</span>
              <span>{LANGUAGES[currentLanguage]?.nativeName}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LANGUAGES).map(([code, lang]) => (
            <SelectItem key={code} value={code}>
              <span className="flex items-center gap-2">
                <span className="text-lg">{lang.flag}</span>
                <span>{lang.nativeName}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

export default LanguageSwitcher;
