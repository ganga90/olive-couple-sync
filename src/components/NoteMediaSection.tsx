import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image, Music, Video, FileText, Download, ExternalLink, MapPin, Play, Pause, X, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useRef } from "react";
import { cn } from "@/lib/utils";

interface NoteMediaSectionProps {
  mediaUrls?: string[] | null;
  location?: { latitude: string; longitude: string } | null;
}

export const NoteMediaSection = ({ mediaUrls, location }: NoteMediaSectionProps) => {
  const [expandedMedia, setExpandedMedia] = useState<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!mediaUrls?.length && !location) {
    return null;
  }

  const getMediaType = (url: string): { type: 'image' | 'audio' | 'video' | 'document'; icon: any; color: string } => {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i)) {
      return { type: 'image', icon: Image, color: 'text-blue-500 bg-blue-500/10' };
    }
    if (lowerUrl.match(/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i)) {
      return { type: 'audio', icon: Music, color: 'text-purple-500 bg-purple-500/10' };
    }
    if (lowerUrl.match(/\.(mp4|mov|avi|wmv|webm|mkv)(\?|$)/i)) {
      return { type: 'video', icon: Video, color: 'text-red-500 bg-red-500/10' };
    }
    return { type: 'document', icon: FileText, color: 'text-orange-500 bg-orange-500/10' };
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

  const totalItems = (mediaUrls?.length || 0) + (location ? 1 : 0);

  const renderMediaPreview = (url: string, index: number) => {
    const { type, icon: Icon, color } = getMediaType(url);
    const isExpanded = expandedMedia === index;
    const fileName = getFileName(url);

    return (
      <div 
        key={index} 
        className={cn(
          "group rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-200",
          "hover:shadow-card hover:border-border",
          isExpanded && "shadow-raised"
        )}
      >
        {/* Header */}
        <div 
          className="flex items-center gap-3 p-3 cursor-pointer"
          onClick={() => setExpandedMedia(isExpanded ? null : index)}
        >
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", color)}>
            <Icon className="h-5 w-5" />
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {fileName}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="secondary" className="text-[10px] h-4 capitalize">
                {type}
              </Badge>
              {!isExpanded && type === 'image' && (
                <span className="text-[10px] text-muted-foreground">Click to preview</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, '_blank');
              }}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              asChild
              onClick={(e) => e.stopPropagation()}
            >
              <a href={url} download target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4" />
              </a>
            </Button>
            <div className={cn(
              "h-6 w-6 flex items-center justify-center rounded-full transition-colors",
              isExpanded ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>
        </div>

        {/* Expanded Preview */}
        {isExpanded && (
          <div className="border-t border-border/50 bg-muted/30 p-3 animate-fade-in">
            {type === 'image' && (
              <div className="relative">
                <img
                  src={url}
                  alt={fileName}
                  className="w-full h-auto rounded-lg max-h-[400px] object-contain bg-background"
                  loading="lazy"
                />
              </div>
            )}
            {type === 'audio' && (
              <div className="bg-background rounded-lg p-4">
                <audio controls className="w-full">
                  <source src={url} />
                  Your browser does not support audio playback.
                </audio>
              </div>
            )}
            {type === 'video' && (
              <video controls className="w-full rounded-lg max-h-[400px] bg-background">
                <source src={url} />
                Your browser does not support video playback.
              </video>
            )}
            {type === 'document' && (
              <div className="text-center py-6 bg-background rounded-lg">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                  <FileText className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Preview not available for this file type
                </p>
                <Button variant="outline" size="sm" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                  </a>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLocation = () => {
    if (!location) return null;

    const { latitude, longitude } = location;
    const googleMapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;

    return (
      <div className="group rounded-xl border border-border/50 bg-card overflow-hidden transition-all duration-200 hover:shadow-card hover:border-border">
        <div className="flex items-center gap-3 p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10 text-success">
            <MapPin className="h-5 w-5" />
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Location attached
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
              {latitude}, {longitude}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="flex-shrink-0"
            asChild
          >
            <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
              <MapPin className="h-3 w-3 mr-1.5" />
              View Map
            </a>
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 animate-fade-up">
      {/* Section Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Image className="h-4 w-4 text-accent" />
          </div>
          <span className="text-sm font-semibold text-foreground">Media & Attachments</span>
          <Badge variant="secondary" className="text-[10px] h-5">
            {totalItems}
          </Badge>
        </div>
        <div className={cn(
          "h-6 w-6 rounded-full flex items-center justify-center transition-colors",
          "text-muted-foreground group-hover:bg-muted group-hover:text-foreground"
        )}>
          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </div>
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="space-y-2 animate-fade-in">
          {location && renderLocation()}
          {mediaUrls?.map((url, index) => renderMediaPreview(url, index))}
        </div>
      )}
    </div>
  );
};
