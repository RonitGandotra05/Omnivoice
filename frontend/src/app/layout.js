import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
export const metadata = {
  title: {
    default: "OmniVoice — Voice Agent Studio",
    template: "%s · OmniVoice",
  },
  description:
    "Build company support agents with document knowledge, routed escalations, and natural voice conversations. Test locally, then connect your business.",
};
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Navbar />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
