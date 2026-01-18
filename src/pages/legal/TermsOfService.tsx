import { useSEO } from "@/hooks/useSEO";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const TermsOfService = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('legal');
  
  useSEO({ 
    title: "Terms of Service — Olive", 
    description: "Terms of Service for using the Olive app" 
  });

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFDF8]">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#FDFDF8]/95 backdrop-blur-sm border-b border-stone-200/50">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="gap-2 text-stone-600 hover:text-stone-900"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t('back')}</span>
          </Button>
          <h1 className="font-serif font-semibold text-[#2A3C24]">{t('terms.title')}</h1>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="text-stone-600 hover:text-stone-900 md:hidden"
          >
            <X className="h-5 w-5" />
          </Button>
          <div className="hidden md:block w-16" />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 pb-24">
        <article className="prose prose-stone prose-lg max-w-none">
          <p className="text-stone-500 text-sm">{t('terms.lastUpdated')}: January 18, 2026</p>
          
          <h2>1. {t('terms.sections.acceptance.title')}</h2>
          <p>
            By accessing or using Olive ("the App"), you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, please do not use the App.
          </p>

          <h2>2. {t('terms.sections.description.title')}</h2>
          <p>
            Olive is a shared organization tool that helps couples and individuals manage tasks, 
            notes, reminders, and calendar events. The App uses artificial intelligence to process 
            and organize your information.
          </p>

          <h2>3. {t('terms.sections.aiDisclaimer.title')}</h2>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
            <p className="text-amber-800 font-medium mb-2">⚠️ Important AI Notice</p>
            <p className="text-amber-700 text-sm">
              Olive uses Artificial Intelligence to process your notes and tasks. While we strive 
              for accuracy, AI suggestions may occasionally be incorrect. Please verify critical 
              dates and reminders manually. Olive is not liable for any losses or damages arising 
              from reliance on AI-generated suggestions.
            </p>
          </div>

          <h2>4. {t('terms.sections.whatsappConsent.title')}</h2>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 my-4">
            <p className="text-green-800 font-medium mb-2">📱 WhatsApp Integration</p>
            <p className="text-green-700 text-sm">
              By connecting Olive to WhatsApp, you expressly consent to receive automated messages, 
              reminders, and notifications from Olive at the phone number provided. Message and 
              data rates may apply. You may opt out at any time by disconnecting the WhatsApp 
              integration from your Profile settings.
            </p>
          </div>

          <h2>5. {t('terms.sections.userAccounts.title')}</h2>
          <p>
            To use Olive, you must create an account. You are responsible for maintaining the 
            confidentiality of your account credentials and for all activities that occur under 
            your account. You agree to notify us immediately of any unauthorized use.
          </p>

          <h2>6. {t('terms.sections.userConduct.title')}</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Submit sensitive health, financial, or illegal content into shared spaces</li>
            <li>Use the App for any unlawful purpose or in violation of any applicable laws</li>
            <li>Attempt to interfere with, compromise, or disrupt the App's systems</li>
            <li>Upload malicious code, viruses, or harmful data</li>
            <li>Impersonate another person or entity</li>
            <li>Share your account credentials with unauthorized parties</li>
          </ul>

          <h2>7. {t('terms.sections.sharedSpaces.title')}</h2>
          <p>
            Olive allows you to create shared spaces with your partner. Content created in shared 
            spaces is visible to all members. You are responsible for ensuring that any content 
            you share is appropriate and does not violate these terms or the privacy of others.
          </p>

          <h2>8. {t('terms.sections.intellectualProperty.title')}</h2>
          <p>
            The App, including its original content, features, and functionality, is owned by 
            Olive and is protected by international copyright, trademark, and other intellectual 
            property laws. You retain ownership of any content you create within the App.
          </p>

          <h2>9. {t('terms.sections.thirdPartyServices.title')}</h2>
          <p>
            Olive integrates with third-party services including Google Calendar and WhatsApp 
            (via Meta/Twilio). Your use of these integrations is subject to the respective 
            third-party terms of service. We are not responsible for the practices of third-party 
            services.
          </p>

          <h2>10. {t('terms.sections.termination.title')}</h2>
          <p>
            We may terminate or suspend your account and access to the App immediately, without 
            prior notice, for conduct that we believe violates these Terms or is harmful to other 
            users, us, or third parties, or for any other reason at our sole discretion.
          </p>

          <h2>11. {t('terms.sections.disclaimers.title')}</h2>
          <p>
            THE APP IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. WE DISCLAIM ALL WARRANTIES, 
            EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND 
            NON-INFRINGEMENT.
          </p>

          <h2>12. {t('terms.sections.limitation.title')}</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, OLIVE SHALL NOT BE LIABLE FOR ANY INDIRECT, 
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF THE APP.
          </p>

          <h2>13. {t('terms.sections.changes.title')}</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify you of any 
            changes by posting the new Terms on this page and updating the "Last Updated" date. 
            Your continued use of the App after such changes constitutes acceptance of the new Terms.
          </p>

          <h2>14. {t('terms.sections.contact.title')}</h2>
          <p>
            If you have questions about these Terms, please contact us at{" "}
            <a href="mailto:legal@witholive.app" className="text-primary hover:underline">
              legal@witholive.app
            </a>
          </p>
        </article>
      </main>
    </div>
  );
};

export default TermsOfService;
