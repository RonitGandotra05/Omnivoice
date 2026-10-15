import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import LinkedInProvider from "next-auth/providers/linkedin";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    AppleProvider({
      clientId: process.env.APPLE_ID || "",
      clientSecret: process.env.APPLE_SECRET || "",
    }),
    LinkedInProvider({
      clientId: process.env.LINKEDIN_CLIENT_ID || "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
      authorization: {
        params: { scope: "openid profile email" },
      },
      issuer: "https://www.linkedin.com",
      jwks_endpoint: "https://www.linkedin.com/oauth/openid/jwks",
      profile(profile, tokens) {
        const defaultImage =
          "https://cdn-icons-png.flaticon.com/512/174/174857.png";
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture || defaultImage,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Intentionally passing down user object if present
      // When user logs in, we'll sync with FastAPI
      if (user && account) {
        token.provider = account.provider;
        token.sso_id = user.id;

        try {
          // Sync with our backend
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"}/api/auth/sso-login`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.INTEGRATION_API_KEY || ""}`,
              },
              body: JSON.stringify({
                email: user.email,
                name: user.name,
                provider: account.provider,
                sso_id: user.id,
              }),
            },
          );

          if (res.ok) {
            const data = await res.json();
            // Store the FastAPI access token in the NextAuth JWT
            token.accessToken = data.access_token;
          } else {
            console.error("Failed to sync with backend:", await res.text());
          }
        } catch (error) {
          console.error("Backend SSO Sync Error:", error);
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Pass the backend access token to the client session
      session.accessToken = token.accessToken;
      return session;
    },
  },
  pages: {
    signIn: "/admin/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

// Next.js App Router exports
export { handler as GET, handler as POST };
