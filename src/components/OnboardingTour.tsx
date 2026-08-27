import { useCallback, useEffect, useState } from "react";

/* ============================================================
   Tour guiado de primera visita. Explica las zonas clave del
   terminal paso a paso. Se guarda en localStorage para no
   volver a aparecer; puede reabrirse desde el pie de página.
   ============================================================ */

interface Step {
  tag: string;
  color: string;
  title: string;
  body: string;
  where: string;
}

const STEPS: Step[] = [
  {
    tag: "RUMBO",
    color: "#2fd6a5",
    title: "¿Long o short? Empieza aquí",
    body: "La aguja grande te dice el sesgo del mercado: apunta a la derecha (verde) = rumbo LONG, a la izquierda (rojo) = rumbo SHORT. Debajo ves el imán de liquidez (a dónde tiende el precio), la invalidación (qué anula el escenario) y la ventana temporal estimada.",
    where: "Zona superior, justo al abrir",
  },
  {
    tag: "CONFLUENCIA",
    color: "#3fb6ff",
    title: "¿Los plazos están de acuerdo?",
    body: "Una señal vale más si 12h, 24h y 72h apuntan al mismo lado. Mira el dial: 3/3 es una señal fuerte, 1/3 o dividido es ruido. Opera solo cuando la mayoría confirma tu rumbo.",
    where: "Debajo del rumbo",
  },
  {
    tag: "MAPA DE CALOR",
    color: "#ffb547",
    title: "Dónde está el combustible",
    body: "Cada barra es un nivel con liquidaciones estimadas. Verde bajo el precio = longs que serán cazados (bajista), rojo arriba = shorts (alcista). El color de cada barra indica el apalancamiento: 10× azul → 100× magenta. Las zonas brillantes son imanes.",
    where: "Panel 02",
  },
  {
    tag: "MOTOR",
    color: "#ff4d6d",
    title: "Por qué el radar opina lo que opina",
    body: "El panel de predicción desglosa los 18 factores (funding, pools, takers, OI…) y cuánto aporta cada uno al sesgo. No es una caja negra: puedes ver exactamente qué está empujando la aguja.",
    where: "Panel 01, columna derecha",
  },
  {
    tag: "LABORATORIO",
    color: "#e05cd0",
    title: "Comprueba que funciona",
    body: "Pulsa «Ejecutar prueba»: re-ejecuta el motor contra 41 días de velas reales y te dice la tasa de acierto, el edge vs azar y qué factores funcionan de verdad. Es la prueba honesta de que la herramienta no es humo.",
    where: "Panel 10",
  },
  {
    tag: "RIESGO",
    color: "#e9f1ff",
    title: "Convierte la señal en un plan",
    body: "Antes de operar, pasa por la gestión de riesgo: define capital y % de riesgo, y calcula el tamaño de posición, el apalancamiento implícito y el ratio R:R contra el objetivo e invalidación del radar.",
    where: "Panel 07",
  },
];

export function OnboardingTour({ forceOpen, onCloseRequest }: { forceOpen: boolean; onCloseRequest: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setOpen(true);
      return;
    }
    try {
      if (!localStorage.getItem("liqradar-tour-v1")) setOpen(true);
    } catch {
      /* noop */
    }
  }, [forceOpen]);

  const finish = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem("liqradar-tour-v1", "1");
    } catch {
      /* noop */
    }
    onCloseRequest();
  }, [onCloseRequest]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-5" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink-950/85 backdrop-blur-sm" onClick={finish} />

      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-ink-900/95 shadow-2xl">
        {/* franja superior */}
        <div
          className="flex items-center justify-between px-6 py-3"
          style={{ background: `linear-gradient(90deg, ${s.color}22, transparent)` }}
        >
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] font-700 tracking-widest" style={{ color: s.color }}>
              {s.tag}
            </span>
            <span className="panel-tag">paso {step + 1} de {STEPS.length}</span>
          </div>
          <button
            onClick={finish}
            className="rounded-md border border-line px-2.5 py-1 font-mono text-[10px] text-dusk transition-colors hover:border-short/60 hover:text-short-hi"
            aria-label="Cerrar tour"
          >
            saltar ✕
          </button>
        </div>

        {/* barra de progreso */}
        <div className="flex h-1 gap-1 px-6">
          {STEPS.map((st, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-all duration-300"
              style={{ background: i <= step ? st.color : "#15233c" }}
            />
          ))}
        </div>

        {/* contenido */}
        <div className="px-6 py-5">
          <h3 className="font-display text-xl font-900 leading-tight tracking-tight text-fog">{s.title}</h3>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-mist">{s.body}</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-line bg-ink-950/60 px-3 py-1.5 font-mono text-[10.5px] text-mist">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <circle cx="6" cy="5" r="3.4" fill="none" stroke={s.color} strokeWidth="1.3" />
              <path d="M6 8.4 L6 11" stroke={s.color} strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            {s.where}
          </div>
        </div>

        {/* navegación */}
        <div className="flex items-center justify-between border-t border-line/60 px-6 py-3.5">
          <button
            onClick={() => setStep((p) => Math.max(0, p - 1))}
            disabled={step === 0}
            className="rounded-md border border-line px-3.5 py-1.5 font-mono text-[11px] text-mist transition-colors hover:border-line hover:text-fog disabled:cursor-not-allowed disabled:opacity-30"
          >
            ← anterior
          </button>

          {last ? (
            <button
              onClick={finish}
              className="rounded-md border border-long/60 bg-long/15 px-5 py-1.5 font-mono text-[11px] font-700 tracking-widest text-long-hi transition-all hover:bg-long/25 hover:shadow-[0_0_18px_-4px_rgba(47,214,165,0.6)]"
            >
              EMPEZAR A OPERAR ✓
            </button>
          ) : (
            <button
              onClick={() => setStep((p) => Math.min(STEPS.length - 1, p + 1))}
              className="rounded-md border border-pulse/60 bg-pulse/10 px-4 py-1.5 font-mono text-[11px] font-700 text-pulse transition-all hover:bg-pulse/20"
            >
              siguiente →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
