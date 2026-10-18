const siteUrl = "https://omnivoice-agent-studio.netlify.app";

export default function sitemap() {
  return [
    { url: `${siteUrl}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/docs`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${siteUrl}/tutorial`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${siteUrl}/contact`, changeFrequency: "yearly", priority: 0.6 },
    { url: `${siteUrl}/try-for-free`, changeFrequency: "monthly", priority: 0.7 },
  ];
}
