import Script from "next/script";

const clientPattern = /^ca-pub-\d+$/;
const slotPattern = /^\d+$/;

export default function AdSlot() {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "";
  const slot = process.env.NEXT_PUBLIC_ADSENSE_SLOT ?? "";
  if (!clientPattern.test(client) || !slotPattern.test(slot)) {
    return (
      <aside className="ad-slot sample" aria-label="Sample ad">
        Sample ad
      </aside>
    );
  }
  return (
    <aside className="ad-slot" aria-label="Advertisement">
      <Script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
      <Script id="adsense-fill" strategy="afterInteractive">
        {"(adsbygoogle = window.adsbygoogle || []).push({});"}
      </Script>
    </aside>
  );
}
