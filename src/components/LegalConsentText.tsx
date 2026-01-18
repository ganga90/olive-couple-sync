import React from "react";
import { useTranslation } from "react-i18next";
import { useLanguage } from "@/providers/LanguageProvider";

interface LegalConsentTextProps {
  className?: string;
}

export const LegalConsentText: React.FC<LegalConsentTextProps> = ({ className }) => {
  const { t } = useTranslation('legal');
  const { getLocalizedPath } = useLanguage();

  return (
    <p className={`text-xs text-muted-foreground text-center ${className || ''}`}>
      {t('consent.agreementText')}{' '}
      <a 
        href={getLocalizedPath('/legal/terms')}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline font-medium"
      >
        {t('consent.termsLink')}
      </a>
      {' '}{t('consent.and')}{' '}
      <a 
        href={getLocalizedPath('/legal/privacy')}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:underline font-medium"
      >
        {t('consent.privacyLink')}
      </a>
      .
    </p>
  );
};
