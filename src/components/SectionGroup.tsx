import { useEffect, useState, type ReactNode } from "react";

/* ============================================================
   Zona plegable: agrupa paneles relacionados bajo una cabecera
   con icono, número, título, subtítulo y badge de estado.
   El estado abierto/cerrado persiste en el navegador.
   ============================================================ */

const LS_KEY = "liqradar-zones-v1";

function loadZoneState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    /* noop */
  }
  return {};
}

interface Props {
  id: string;
  num: string; // "Z1"
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent: string; // color de acento de la zona
  defaultOpen?: boolean;
  badge?: ReactNode; // chip de estado a la derecha
  children: ReactNode;
}

export function SectionGroup({ id, num, title, subtitle, icon, accent, defaultOpen = true, badge, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = loadZoneState()[id];
    return saved !== undefined ? saved : defaultOpen;
  });

  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try {
        const all = loadZoneState();
        all[id] = next;
        localStorage.setItem(LS_KEY, JSON.stringify(all));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  // accesibilidad: cerrar con Escape cuando tiene el foco
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open && document.activeElement?.closest(`[data-zone="${id}"]`)) {
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  return (
    <section data-zone={id} id={id} className="zone-scroll mt-7 first:mt-0">
      {/* cabecera plegable */}
      <button
        onClick={toggle}
        aria-expanded={open}
        className="group flex w-full items-center gap-3.5 rounded-lg border border-line/60 bg-ink-900/50 px-4 py-3 text-left transition-all duration-200 hover:border-line hover:bg-ink-850/70"
        style={{ boxShadow: open ? `inset 3px 0 0 ${accent}` : "inset 3px 0 0 transparent" }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-transform duration-200 group-hover:scale-105"
          style={{ borderColor: `${accent}44`, background: `${accent}0f`, color: accent }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="flex items-baseline gap-2.5">
            <span className="font-mono text-[10px] font-700 tracking-[0.2em]" style={{ color: accent }}>
              {num}
            </span>
            <span className="font-display truncate text-[15px] font-700 tracking-tight text-fog sm:text-base">
              {title}
            </span>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-dusk">{subtitle}</span>
        </span>

        {badge && <span className="ml-2 hidden sm:block">{badge}</span>}

        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden
          className="ml-auto shrink-0 text-dusk transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* contenido con colapso animado */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="pt-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
