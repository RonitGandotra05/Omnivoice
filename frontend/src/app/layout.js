import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { AccountPreferences } from "@/components/AccountPreferences";
export const metadata = {
  metadataBase: new URL("https://omnivoice-agent-studio.netlify.app"),
  title: {
    default: "OmniVoice — AI Voice Agent Studio for Customer Support",
    template: "%s · OmniVoice",
  },
  description:
    "Build company support agents with document knowledge, routed escalations, and natural voice conversations. Test locally, then connect your business.",
  openGraph: {
    type: "website",
    siteName: "OmniVoice",
    title: "OmniVoice — AI Voice Agent Studio for Customer Support",
    description:
      "Build company support agents grounded in your documents, with natural voice conversations and clear human handoffs.",
    images: ["/voice-sculpture.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "OmniVoice — AI Voice Agent Studio for Customer Support",
    description:
      "Build company support agents grounded in your documents, with natural voice conversations and clear human handoffs.",
    images: ["/voice-sculpture.png"],
  },
};
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ov-theme')||'system';document.documentElement.dataset.theme=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}`,
          }}
        />
        <AccountPreferences>
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <Navbar />
          <main id="main-content">{children}</main>
          <Footer />
        </AccountPreferences>
      </body>
    </html>
  );
}
