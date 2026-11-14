import type { Metadata } from "next";
import { headers } from "next/headers";
import { getIdentity } from "../../cursor/identity.js";
import AdSlot from "@/components/AdSlot";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/500.css";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Go",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const incoming = await headers();
  const list = new Headers();
  incoming.forEach((value, key) => {
    list.set(key, value);
  });
  const identity = await getIdentity(new Request("http://localhost/", { headers: list }));
  const name = identity.verified && identity.kind === "person" ? identity.name : "";

  return (
    <html lang="en">
      <body>
        <div className="ambient" />
        <div className="grain" />
        <header className="nav">
          <a className="wordmark" href="/">
            Go
          </a>
          <span className="nav-side">
            <a className="nav-name" href="/stats">
              Stats
            </a>
            {name ? <span className="nav-name">{name}</span> : null}
          </span>
        </header>
        {children}
        <AdSlot />
      </body>
    </html>
  );
}
