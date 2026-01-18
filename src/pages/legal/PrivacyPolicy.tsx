import { useSEO } from "@/hooks/useSEO";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('legal');
  
  useSEO({ 
    title: "Privacy Policy — Olive", 
    description: "Privacy Policy for the Olive app" 
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
          <h1 className="font-serif font-semibold text-[#2A3C24]">{t('privacy.title')}</h1>
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
          <p className="text-stone-500 text-sm">{t('privacy.lastUpdated')}: January 18, 2026</p>
          
          <h2>1. {t('privacy.sections.introduction.title')}</h2>
          <p>
            At Olive ("we", "our", "us"), we are committed to protecting your privacy. This Privacy 
            Policy explains how we collect, use, disclose, and safeguard your information when you 
            use our mobile application and web service.
          </p>

          <h2>2. {t('privacy.sections.dataCollection.title')}</h2>
          <p>We collect the following types of information:</p>
          
          <h3>Account Information</h3>
          <ul>
            <li>Name and email address (provided during registration)</li>
            <li>Profile information and preferences</li>
            <li>Phone number (for WhatsApp integration)</li>
          </ul>

          <h3>User Content</h3>
          <ul>
            <li>Notes, tasks, and reminders you create</li>
            <li>Shared lists and collaborative content</li>
            <li>Media files (images, audio) you upload</li>
            <li>Memories and personalization data you provide</li>
          </ul>

          <h3>Calendar Data</h3>
          <ul>
            <li>Calendar events synced from Google Calendar (when connected)</li>
            <li>Event titles, dates, times, and descriptions</li>
          </ul>

          <h3>Usage Information</h3>
          <ul>
            <li>Device information and identifiers</li>
            <li>App usage patterns and feature interactions</li>
            <li>Error logs and performance data</li>
          </ul>

          <h2>3. {t('privacy.sections.googleLimitedUse.title')}</h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 my-4">
            <p className="text-blue-800 font-medium mb-2">🔒 Google API Services Compliance</p>
            <p className="text-blue-700 text-sm">
              Olive's use and transfer to any other app of information received from Google APIs 
              will adhere to the{" "}
              <a 
                href="https://developers.google.com/terms/api-services-user-data-policy" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
          </div>
          <p>
            We only access Google Calendar data that you explicitly authorize. We use this data 
            solely to display your events within Olive and to create calendar entries from your 
            tasks. We do not share Google Calendar data with third parties except as required to 
            provide the service.
          </p>

          <h2>4. {t('privacy.sections.whatsappIntegration.title')}</h2>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 my-4">
            <p className="text-green-800 font-medium mb-2">📱 WhatsApp Data Processing</p>
            <p className="text-green-700 text-sm">
              Messages sent to the Olive WhatsApp bot are processed by third-party providers 
              (specifically Meta/Twilio) solely to provide the organization service. Message 
              content is processed to extract tasks and is stored securely in our database.
            </p>
          </div>

          <h2>5. {t('privacy.sections.howWeUse.title')}</h2>
          <p>We use your information to:</p>
          <ul>
            <li>Provide, maintain, and improve the Olive service</li>
            <li>Process and organize your notes using AI technology</li>
            <li>Send you reminders and notifications you've requested</li>
            <li>Sync your tasks with Google Calendar</li>
            <li>Personalize your experience based on your memories and preferences</li>
            <li>Communicate with you about service updates</li>
            <li>Ensure security and prevent fraud</li>
          </ul>

          <h2>6. {t('privacy.sections.aiProcessing.title')}</h2>
          <p>
            Olive uses artificial intelligence (Google Gemini) to process your notes and tasks. 
            This processing occurs on secure servers and is used to:
          </p>
          <ul>
            <li>Extract tasks, dates, and priorities from your notes</li>
            <li>Categorize and organize your content</li>
            <li>Generate helpful suggestions and tips</li>
            <li>Understand natural language commands</li>
          </ul>

          <h2>7. {t('privacy.sections.dataSharing.title')}</h2>
          <p>We may share your information with:</p>
          <ul>
            <li><strong>Your Partner:</strong> Content in shared spaces is visible to both members</li>
            <li><strong>Service Providers:</strong> Third-party services that help us operate (hosting, AI processing)</li>
            <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
          </ul>
          <p>
            We do not sell your personal information to third parties.
          </p>

          <h2>8. {t('privacy.sections.dataSecurity.title')}</h2>
          <p>
            We implement appropriate technical and organizational measures to protect your data, 
            including encryption in transit and at rest, secure authentication, and regular 
            security audits. OAuth tokens for third-party services are encrypted using industry-standard 
            encryption.
          </p>

          <h2>9. {t('privacy.sections.dataRetention.title')}</h2>
          <p>
            We retain your data for as long as your account is active or as needed to provide 
            services. You can request deletion of your data at any time by contacting us or 
            using the data export feature in your Profile settings.
          </p>

          <h2>10. {t('privacy.sections.yourRights.title')}</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate data</li>
            <li>Request deletion of your data</li>
            <li>Export your data in a portable format</li>
            <li>Withdraw consent for optional processing</li>
            <li>Disconnect third-party integrations at any time</li>
          </ul>

          <h2>11. {t('privacy.sections.children.title')}</h2>
          <p>
            Olive is not intended for children under 13 years of age. We do not knowingly collect 
            personal information from children under 13.
          </p>

          <h2>12. {t('privacy.sections.internationalTransfers.title')}</h2>
          <p>
            Your information may be transferred to and processed in countries other than your own. 
            We ensure appropriate safeguards are in place for such transfers.
          </p>

          <h2>13. {t('privacy.sections.changes.title')}</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes 
            by posting the new Privacy Policy on this page and updating the "Last Updated" date.
          </p>

          <h2>14. {t('privacy.sections.contact.title')}</h2>
          <p>
            For questions about this Privacy Policy or our data practices, please contact us at{" "}
            <a href="mailto:privacy@witholive.app" className="text-primary hover:underline">
              privacy@witholive.app
            </a>
          </p>
        </article>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
