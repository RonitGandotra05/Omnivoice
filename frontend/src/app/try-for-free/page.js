import StudioAccess from "@/components/StudioAccess";
export const metadata = {
  title: "Try the Studio",
  description:
    "Set up a company support agent, add business knowledge, and try a voice conversation in OmniVoice.",
  alternates: { canonical: "/try-for-free" },
};
export default function StudioPage() {
  return <StudioAccess />;
}
