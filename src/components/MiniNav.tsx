import { useEffect, useState } from "react";

/* ============================================================
   Mini-navegación fija: saltos rápidos entre las 5 zonas del
   terminal, con resaltado de la zona visible (scroll-spy).
   ============================================================ */

export interface ZoneDef {
  id: string;
  label: string;
  accent: string;
}

export function MiniNav({ zones }: { zones: ZoneDef[] }) {
  const [active, setActive] = useState<string>(zones[0]?.id ?? "");

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const probe = window.scrollY + 140;
        let current = zones[0]?.id ?? "";
        for (const z of zones) {
          const el = document.getElementById(z.id);
          if (el && el.offsetTop <= probe) current = z.id;
        }
        setActive(current);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [zones]);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="sticky top-0 z-30 border-b border-line/60 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] items-center gap-1.5 overflow-x-auto px-5 py-2 slim-scroll">
        <span className="mr-2 hidden shrink-0 font-mono text-[9.5px] tracking-[0.25em] text-dusk md:block">ZONAS</span>
        {zones.map((z) => {
          const on = active === z.id;
          return (
            <button
              key={z.id}
              onClick={() => go(z.id)}
              className="relative shrink-0 rounded-md px-3 py-1.5 font-mono text-[11px] font-600 tracking-wide transition-all duration-200"
              style={{
                color: on ? z.accent : "#93a5c8",
                background: on ? `${z.accent}12` : "transparent",
                border: `1px solid ${on ? `${z.accent}55` : "transparent"}`,
              }}
            >
              {z.label}
              <span
                className="absolute inset-x-3 -bottom-2 h-[2px] rounded-full transition-all duration-300"
                style={{ background: on ? z.accent : "transparent", opacity: on ? 0.9 : 0 }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
