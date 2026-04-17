import { useEffect } from "react";

const BASE_URL = "https://www.witholive.app";

function setMetaTag(
  attribute: "name" | "property",
  key: string,
  content: string
) {
  let meta = document.querySelector(
    `meta[${attribute}="${key}"]`
  ) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

export function useSEO({
  title,
  description,
  canonical,
}: {
  title: string;
  description?: string;
  canonical?: string;
}) {
  useEffect(() => {
    if (title) {
      document.title = title;
      setMetaTag("property", "og:title", title);
      setMetaTag("name", "twitter:title", title);
    }

    if (description) {
      setMetaTag("name", "description", description);
      setMetaTag("property", "og:description", description);
      setMetaTag("name", "twitter:description", description);
    }

    const href = canonical || window.location.href;
    const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;

    let link = document.querySelector(
      'link[rel="canonical"]'
    ) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = fullUrl;
    setMetaTag("property", "og:url", fullUrl);
  }, [title, description, canonical]);
}
