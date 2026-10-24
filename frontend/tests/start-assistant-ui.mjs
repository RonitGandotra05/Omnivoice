// Disposable UI fixture: production components, isolated browser origin, synthetic auth/provider.
// Does not change application routes or use real credentials. Stop with Ctrl-C to remove it.
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const source = process.cwd(),
  dir = mkdtempSync(path.join(tmpdir(), "omnivoice-assistant-ui-"));
const write = (name, text) => {
  mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  writeFileSync(path.join(dir, name), text);
};
symlinkSync(
  path.join(source, "node_modules"),
  path.join(dir, "node_modules"),
  "dir",
);
mkdirSync(path.join(dir, "src"));
for (const name of ["lib", "components"])
  symlinkSync(
    path.join(source, "src", name),
    path.join(dir, "src", name),
    "dir",
  );
write(
  "package.json",
  JSON.stringify({
    private: true,
    type: "module",
    dependencies: { next: "*", react: "*", "react-dom": "*" },
  }),
);
write(
  "jsconfig.json",
  JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
);
write(
  "next.config.mjs",
  `export default { devIndicators:false, experimental:{externalDir:true}, webpack(config){config.resolve.alias['@']= ${JSON.stringify(path.join(dir, "src"))};return config;} };`,
);
write(
  "src/app/layout.js",
  `import ${JSON.stringify(path.join(source, "src/app/globals.css"))};export default function Layout({children}){return <html lang="en"><body>{children}</body></html>}`,
);
write(
  "src/app/page.js",
  `import SupportStudio from '@/components/SupportStudio';export default function Page(){return <SupportStudio/>}`,
);
write(
  "src/app/api/studio/[...path]/route.js",
  `import {createStudioHandler} from '@/lib/server/studio-handler.mjs';const handler=createStudioHandler({env:{SUPPORT_STORAGE:'browser',PUBLIC_APP_URL:'http://127.0.0.1:3107'}});export async function GET(req,ctx){return handler(req,(await ctx.params).path.join('/'));}`,
);
write(
  "src/app/api/company-assistant/route.js",
  `import {createCompanyAssistant} from '@/lib/server/company-assistant.mjs';export const POST=createCompanyAssistant({env:{GEMINI_API_KEY:'fixture-not-a-real-key',STUDIO_SESSION_SECRET:'fixture-secret-for-ui-only-32-characters',PUBLIC_APP_URL:'http://127.0.0.1:3107'}, accountForRequest:async()=>({id:'fixture-user',email_verified:true}),ingress:async()=>{},reserve:async()=> 'fixture-reservation',finish:async()=>{},networkForRequest:()=> '127.0.0.1',generate:async()=>({text:JSON.stringify({in_scope:true,updates:{company_name:'Northstar Dental',support_email:'hello@northstar.example'},evidence:{company_name:'Northstar Dental',support_email:'hello@northstar.example'}})})});`,
);
const child = spawn(
  process.execPath,
  [
    path.join(source, "node_modules/next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3107",
  ],
  {
    cwd: dir,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "development",
    },
  },
);
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", () => {
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
});
