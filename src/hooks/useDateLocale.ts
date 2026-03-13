import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { enUS } from 'date-fns/locale/en-US';
import { es } from 'date-fns/locale/es';
import { it } from 'date-fns/locale/it';

export const useDateLocale = () => {
  const { i18n } = useTranslation();
  
  const dateLocale = useMemo(() => {
    switch (i18n.language) {
      case 'es-ES':
        return es;
      case 'it-IT':
        return it;
      default:
        return enUS;
    }
  }, [i18n.language]);
  
  return dateLocale;
};
