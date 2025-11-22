import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image, Music, Video, FileText, Download, ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";

interface NoteMediaSectionProps {
  mediaUrls?: string[] | null;
  location?: { latitude: string; longitude: string } | null;
}

export const NoteMediaSection = ({ mediaUrls, location }: NoteMediaSectionProps) => {
  const [expandedMedia, setExpandedMedia] = useState<number | null>(null);

  if (!mediaUrls?.length && !location) {
    return null;
  }

  const getMediaType = (url: string): { type: 'image' | 'audio' | 'video' | 'document'; icon: any } => {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i)) {
      return { type: 'image', icon: Image };
    }
    if (lowerUrl.match(/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i)) {
      return { type: 'audio', icon: Music };
    }
    if (lowerUrl.match(/\.(mp4|mov|avi|wmv|webm|mkv)(\?|$)/i)) {
      return { type: 'video', icon: Video };
    }
    return { type: 'document', icon: FileText };
  };

  const getFileName = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const parts = pathname.split('/');
      return decodeURIComponent(parts[parts.length - 1] || 'Unknown file');
    } catch {
      return 'Media file';
    }
  };

  const renderMediaPreview = (url: string, index: number) => {
    const { type, icon: Icon } = getMediaType(url);
    const isExpanded = expandedMedia === index;

    return (
      <Card key={index} className="overflow-hidden border-olive/20 bg-white/50 shadow-soft">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Icon className="h-5 w-5 text-olive flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-olive-dark truncate">
                  {getFileName(url)}
                </p>
                <Badge variant="secondary" className="mt-1 text-xs">
                  {type}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-olive/10"
                onClick={() => setExpandedMedia(isExpanded ? null : index)}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-olive/10"
                asChild
              >
                <a href={url} download target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>

          {isExpanded && (
            <div className="mt-3 border-t border-olive/10 pt-3">
              {type === 'image' && (
                <img
                  src={url}
                  alt={getFileName(url)}
                  className="w-full h-auto rounded-lg max-h-[400px] object-contain bg-muted"
                  loading="lazy"
                />
              )}
              {type === 'audio' && (
                <audio controls className="w-full">
                  <source src={url} />
                  Your browser does not support audio playback.
                </audio>
              )}
              {type === 'video' && (
                <video controls className="w-full rounded-lg max-h-[400px]">
                  <source src={url} />
                  Your browser does not support video playback.
                </video>
              )}
              {type === 'document' && (
                <div className="text-center p-4 bg-muted rounded-lg">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Preview not available for this file type
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    asChild
                  >
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      Open in new tab
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderLocation = () => {
    if (!location) return null;

    const { latitude, longitude } = location;
    const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    return (
      <Card className="overflow-hidden border-olive/20 bg-white/50 shadow-soft">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <MapPin className="h-5 w-5 text-olive flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-olive-dark">
                  Location attached
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {latitude}, {longitude}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-olive/10 flex-shrink-0"
              asChild
            >
              <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Media & Attachments
      </div>
      <div className="space-y-2">
        {location && renderLocation()}
        {mediaUrls?.map((url, index) => renderMediaPreview(url, index))}
      </div>
    </div>
  );
};
