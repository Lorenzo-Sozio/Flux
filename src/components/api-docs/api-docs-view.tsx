"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";

import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Lock,
  Server,
  Shield,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  type ApiEndpoint,
  type ApiGroup,
  type AuthLevel,
  type Method,
  type Param,
  responsesFor,
} from "@/lib/api-docs/public-api";
import { cn } from "@/lib/utils";

/**
 * The API reference as a page: groups, endpoints, parameters, examples. The same view for
 * the staff reference and the public one; only the groups and the tools differ.
 */
// ─── Sub-components ────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<Method, string> = {
  GET: "bg-emerald-100 text-emerald-800 border-emerald-200",
  POST: "bg-blue-100 text-blue-800 border-blue-200",
  PUT: "bg-orange-100 text-orange-800 border-orange-200",
  PATCH: "bg-yellow-100 text-yellow-800 border-yellow-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

function MethodBadge({ method, small = false }: { method: Method; small?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded border font-bold font-mono uppercase",
        small ? "px-1.5 py-0.5 text-[9px]" : "px-2.5 py-1 text-xs",
        METHOD_STYLES[method],
      )}
    >
      {method}
    </span>
  );
}

const AUTH_CONFIG: Record<AuthLevel, { label: string; icon: React.ElementType; className: string }> = {
  public: {
    label: "Pubblico",
    icon: Globe,
    className: "bg-gray-100 text-gray-700",
  },
  session: {
    label: "Session Required",
    icon: Lock,
    className: "bg-amber-100 text-amber-800",
  },
  admin: {
    label: "Admin / Owner",
    icon: Shield,
    className: "bg-red-100 text-red-700",
  },
  cron: {
    label: "CRON_SECRET / Webhook",
    icon: Zap,
    className: "bg-purple-100 text-purple-800",
  },
};

function AuthBadge({ level }: { level: AuthLevel }) {
  const cfg = AUTH_CONFIG[level];
  const Icon = cfg.icon;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs", cfg.className)}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const cls =
    status >= 500
      ? "bg-red-100 text-red-700"
      : status >= 400
        ? "bg-orange-100 text-orange-700"
        : status >= 300
          ? "bg-blue-100 text-blue-700"
          : "bg-emerald-100 text-emerald-700";
  return <span className={cn("rounded px-2 py-0.5 font-bold font-mono text-xs", cls)}>{status}</span>;
}

function CodeBlock({ code, lang = "json", label }: { code: string; lang?: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).catch((_err) => {
      // silently ignore clipboard errors
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="flex items-center justify-between border-gray-200 border-b bg-white px-4 py-2">
        <span className="font-mono text-[11px] text-gray-400">{label ?? lang}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-emerald-600">Copiato</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copia
            </>
          )}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-4 text-[12px] text-gray-700 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ParamTable({ params }: { params: Param[] }) {
  const locationLabel: Record<string, string> = {
    query: "query",
    path: "path",
    body: "body",
    form: "form-data",
    header: "header",
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-gray-200 border-b bg-gray-50">
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
              Parametro
            </th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">In</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">Tipo</th>
            <th className="px-3 py-2 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
              Descrizione
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {params.map((p) => (
            <tr key={p.name} className="hover:bg-gray-50">
              <td className="px-3 py-3">
                <div className="flex items-center gap-1.5">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-[11px] text-gray-800">
                    {p.name}
                  </code>
                  {p.required && <span className="font-bold text-[9px] text-red-500 uppercase tracking-wide">req</span>}
                </div>
              </td>
              <td className="px-3 py-3">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">
                  {locationLabel[p.in]}
                </span>
              </td>
              <td className="px-3 py-3 font-mono text-[11px] text-gray-500">{p.type}</td>
              <td className="px-3 py-3 text-gray-500 text-sm">
                <span>{p.description}</span>
                {p.enum && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.enum.map((v) => (
                      <code key={v} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-700">
                        {v}
                      </code>
                    ))}
                  </div>
                )}
                {p.example && (
                  <div className="mt-1 font-mono text-[10px] text-gray-400">
                    es: <code>{p.example}</code>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointSection({
  endpoint,
  sectionRef,
}: {
  endpoint: ApiEndpoint;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div id={endpoint.id} ref={sectionRef} className="scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Endpoint header */}
      <div className="flex flex-wrap items-start gap-3 border-gray-200 border-b p-5">
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 break-all font-mono font-semibold text-gray-900 text-sm">{endpoint.path}</code>
        <AuthBadge level={endpoint.auth} />
        {endpoint.scope && (
          <Badge variant="outline" className="font-mono text-[11px]" title="Ambito richiesto alla chiave API">
            {endpoint.scope}
          </Badge>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {/* Come per le sezioni: chi scrive paragrafi deve poterli avere. */}
        <p className="mb-5 whitespace-pre-line text-gray-500 text-sm leading-relaxed">{endpoint.description}</p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: params + request body */}
          <div className="space-y-5">
            {endpoint.parameters && endpoint.parameters.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold text-gray-400 text-xs uppercase tracking-wide">Parametri</h4>
                <ParamTable params={endpoint.parameters} />
              </div>
            )}

            {endpoint.requestBody && (
              <div>
                <h4 className="mb-2 font-semibold text-gray-400 text-xs uppercase tracking-wide">Request Body</h4>
                <CodeBlock
                  code={endpoint.requestBody.example}
                  lang={endpoint.requestBody.contentType}
                  label={endpoint.requestBody.contentType}
                />
              </div>
            )}
          </div>

          {/* Right: responses */}
          <div className="space-y-4">
            <h4 className="font-semibold text-gray-400 text-xs uppercase tracking-wide">Risposte</h4>
            {responsesFor(endpoint).map((r) => (
              <div key={`${r.status}-${r.description}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="text-gray-500 text-xs">{r.description}</span>
                </div>
                <CodeBlock code={r.example} label={`${r.status} Response`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupSection({
  group,
  groupRef,
  endpointRef,
}: {
  group: ApiGroup;
  groupRef: (el: HTMLElement | null) => void;
  endpointRef: (id: string, el: HTMLElement | null) => void;
}) {
  const Icon = group.icon;

  return (
    <section id={group.id} ref={groupRef} className="scroll-mt-4 space-y-4">
      {/* Group header */}
      <div className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <Icon className={cn("h-5 w-5", group.color)} />
        </div>
        <div>
          <h2 className="font-bold text-gray-900 text-lg">{group.label}</h2>
          {/*
            `whitespace-pre-line` so a section that needs paragraphs can have
            them. Descriptions written as one block are unaffected: they contain
            no newlines to honour.
          */}
          <p className="mt-1 whitespace-pre-line text-gray-500 text-sm leading-relaxed">{group.description}</p>
        </div>
      </div>

      {/* Endpoints */}
      {group.endpoints.map((ep) => (
        <EndpointSection key={ep.id} endpoint={ep} sectionRef={(el) => endpointRef(ep.id, el)} />
      ))}
    </section>
  );
}

function ErrorCodesSection() {
  const errors = [
    {
      status: 400,
      name: "Bad Request",
      description:
        "La richiesta contiene parametri non validi, mancanti o in un formato errato. Controlla il body JSON o i query parameter.",
    },
    {
      status: 401,
      name: "Unauthorized",
      description: "L'utente non è autenticato. La sessione è assente o scaduta. Effettua il login e riprova.",
    },
    {
      status: 403,
      name: "Forbidden",
      description:
        "L'utente è autenticato ma non ha i permessi necessari per questa operazione (es. tentativo di eliminare un documento altrui).",
    },
    {
      status: 404,
      name: "Not Found",
      description: "La risorsa richiesta non esiste o non è stata trovata nel database.",
    },
    {
      status: 409,
      name: "Conflict",
      description: "Lo stato attuale della risorsa non permette l'operazione richiesta (es. preventivo già accettato).",
    },
    {
      status: 413,
      name: "Payload Too Large",
      description: "Il file caricato supera il limite consentito (10 MB per i documenti).",
    },
    {
      status: 415,
      name: "Unsupported Media Type",
      description:
        "Il tipo MIME del file non è nella whitelist, l'estensione non corrisponde al MIME dichiarato, o i magic bytes del file non corrispondono al tipo dichiarato.",
    },
    {
      status: 500,
      name: "Internal Server Error",
      description:
        "Errore imprevisto lato server, o database del workspace irraggiungibile. I webhook rispondono 500 apposta, per far ritentare il mittente. Controlla i log. ⚠️ Un workspace sbagliato NON arriva qui: una credenziale senza workspace risponde 400, uno inesistente 404.",
    },
    {
      status: 503,
      name: "Service Unavailable",
      description: "Un servizio esterno (es. API tassi di cambio) non è disponibile. Riprova dopo qualche minuto.",
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 border-gray-200 border-b p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 bg-red-50">
          <AlertCircle className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <h2 className="font-bold text-lg">Codici di Errore</h2>
          <p className="text-gray-500 text-sm">
            Tutti gli errori restituiscono un body JSON con il campo{" "}
            <code className="rounded bg-gray-100 px-1 text-xs">error</code>: stringa descrittiva.
          </p>
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4">
          <CodeBlock
            code={JSON.stringify({ error: "Descrizione leggibile dell'errore" }, null, 2)}
            label="Formato errore standard"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-gray-200 border-b bg-gray-50">
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Codice
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Nome
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-400 text-xs uppercase tracking-wide">
                  Causa tipica
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {errors.map((e) => (
                <tr key={e.status} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{e.name}</td>
                  <td className="px-4 py-3 text-gray-500">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Postman Toolbar ───────────────────────────────────────────────────────────

function PostmanToolbar() {
  const [collectionUrl, setCollectionUrl] = useState<string>("/admin/api-docs/postman-collection.json");
  const [nativeUrl, setNativeUrl] = useState<string>("");
  const [webUrl, setWebUrl] = useState<string>("");
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const base = window.location.origin;
    const col = `${base}/admin/api-docs/postman-collection.json`;
    setCollectionUrl(col);
    // postman:// URI opens the desktop app and fetches the collection locally
    // — works even on localhost, requires Postman desktop to be installed.
    setNativeUrl(`postman://app/collections/import?url=${encodeURIComponent(col)}`);
    // Web URL only works when the server is publicly accessible (not localhost).
    setWebUrl(`https://app.getpostman.com/run-collection?url=${encodeURIComponent(col)}`);
    setIsLocalhost(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);

  function copyCollectionUrl() {
    navigator.clipboard.writeText(collectionUrl).catch((_err) => {
      // silently ignore clipboard permission errors
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-5 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
      <div className="flex flex-wrap items-start gap-4">
        {/* Left: title + description */}
        <div className="min-w-48 flex-1">
          <p className="font-semibold text-gray-900 text-sm">Testa in Postman</p>
          <p className="mt-0.5 text-gray-500 text-xs leading-relaxed">
            Importa la collezione pre-configurata con variabili{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{baseUrl}}"}</code>,{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{apiKey}}"}</code> e{" "}
            <code className="rounded bg-white px-1 py-0.5 text-[10px] text-blue-700">{"{{cronSecret}}"}</code> già
            impostate.
          </p>
        </div>

        {/* Right: action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: open Postman desktop via postman:// URI scheme — works on localhost */}
          {nativeUrl && (
            <a
              href={nativeUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF6C37] px-4 py-2 font-semibold text-white text-xs shadow-sm transition-opacity hover:opacity-90"
              title="Apre l'app desktop Postman e importa la collezione"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Import in Postman
            </a>
          )}

          {/* Secondary: Postman web — only useful when server is publicly accessible */}
          {webUrl && !isLocalhost && (
            <a
              href={webUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#FF6C37]/40 bg-white px-3 py-2 font-medium text-[#FF6C37] text-xs shadow-sm transition-colors hover:bg-orange-50"
              title="Apre Postman Web (richiede URL pubblico)"
            >
              <ExternalLink className="h-3 w-3" />
              Postman Web
            </a>
          )}

          {/* Download Postman Collection */}
          <a
            href="/admin/api-docs/postman-collection.json"
            download="flux-crm-postman-collection.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </a>

          {/* Download OpenAPI Spec */}
          <a
            href="/admin/api-docs/openapi.json"
            download="flux-crm-openapi.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            <FileText className="h-3.5 w-3.5" />
            OpenAPI
          </a>

          {/* Copy collection URL */}
          <button
            type="button"
            onClick={copyCollectionUrl}
            title="Copia URL della collezione"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-medium text-gray-700 text-xs shadow-sm transition-colors hover:bg-gray-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-600">Copiato!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                URL
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collection URL + localhost hint */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-white/60 px-3 py-2">
          <Globe className="h-3.5 w-3.5 shrink-0 text-blue-400" />
          <code className="flex-1 truncate font-mono text-[10px] text-blue-700">{collectionUrl}</code>
          <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-[9px] text-blue-600 uppercase tracking-wide">
            Public
          </span>
        </div>
        {isLocalhost && (
          <p className="flex items-center gap-1.5 text-[10px] text-amber-600">
            <Info className="h-3 w-3 shrink-0" />
            <span>
              Localhost rilevato — <strong>Import in Postman</strong> usa l'app desktop (che può raggiungere localhost).
              Il pulsante <em>Postman Web</em> è nascosto perché richiede un URL pubblico.
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function ApiDocsView({
  groups,
  variant,
}: {
  groups: ApiGroup[];
  /** `admin` adds the Postman tools, which read the staff-only collection. */
  variant: "admin" | "public";
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["authentication", "tenant", "contacts", "crm-import"]),
  );
  const [activeId, setActiveId] = useState<string>("authentication");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  function scrollTo(id: string) {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }

  function toggleGroup(id: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex min-h-full gap-6">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          {/* API badge */}
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Code2 className="h-4 w-4 text-gray-700" />
              <span className="font-bold font-mono text-gray-900 text-xs">API Reference</span>
              <Badge className="ml-auto h-4 bg-blue-100 px-1.5 text-[10px] text-blue-700 hover:bg-blue-100">v1</Badge>
            </div>
            <p className="mt-2 font-mono text-[10px] text-gray-400">Base URL</p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-blue-600">{"{tenant}"}.domain.com/api</p>
          </div>

          {/* Nav */}
          <nav className="space-y-0.5">
            {groups.map((group) => {
              const Icon = group.icon;
              const isExpanded = expandedGroups.has(group.id);
              const count = group.endpoints.length;

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => {
                      scrollTo(group.id);
                      if (count > 0) toggleGroup(group.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-xs transition-colors",
                      activeId === group.id
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", group.color)} />
                    <span className="flex-1 truncate">{group.label}</span>
                    {count > 0 && (
                      <>
                        <span className="rounded bg-gray-100 px-1 py-0.5 font-bold text-[9px] text-gray-500">
                          {count}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                      </>
                    )}
                  </button>

                  {isExpanded && count > 0 && (
                    <div className="mt-0.5 ml-5 space-y-0.5 border-gray-200 border-l pl-3">
                      {group.endpoints.map((ep) => (
                        <button
                          key={ep.id}
                          type="button"
                          onClick={() => scrollTo(ep.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            activeId === ep.id
                              ? "bg-blue-50 text-blue-700"
                              : "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
                          )}
                        >
                          <MethodBadge method={ep.method} small />
                          <span className="min-w-0 truncate font-mono text-[10px]">{ep.path.replace("/api", "")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={() => scrollTo("error-codes")}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium text-xs transition-colors",
                activeId === "error-codes"
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
              )}
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
              <span>Error Codes</span>
            </button>
          </nav>
        </div>
      </aside>

      {/* ── Main Content ───────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-8 pb-20">
        {/* Hero header */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-900">
              <Terminal className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-bold text-2xl text-gray-900 tracking-tight">Flux CRM API Reference</h1>
                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">v1.0</Badge>
              </div>
              <p className="mt-1 text-gray-500 text-sm">
                Documentazione completa degli endpoint HTTP. Base URL:{" "}
                <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-blue-600">
                  {"https://{tenant}.domain.com/api"}
                </code>
              </p>

              <div className="mt-4 flex flex-wrap gap-4">
                {[
                  { dot: "bg-cyan-400", text: "Multi-tenant su un dominio solo: il workspace lo dice la credenziale" },
                  {
                    dot: "bg-amber-400",
                    text: "Chiave del workspace, chiave di piattaforma con X-Tenant-ID, o sessione",
                  },
                  { dot: "bg-blue-400", text: "Risposte JSON (salvo CSV / HTML / GIF)" },
                  { dot: "bg-purple-400", text: "Webhook firmati (Stripe HMAC, Resend)" },
                  { dot: "bg-yellow-400", text: "Cron protetti da Authorization: Bearer $CRON_SECRET" },
                ].map(({ dot, text }) => (
                  <span key={text} className="flex items-center gap-1.5 text-gray-500 text-xs">
                    <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
                    {text}
                  </span>
                ))}
              </div>

              {variant === "admin" ? <PostmanToolbar /> : <OpenApiLink />}
            </div>
          </div>
        </div>

        {/* Group sections */}
        {groups.map((group) => (
          <GroupSection
            key={group.id}
            group={group}
            groupRef={(el) => {
              sectionRefs.current[group.id] = el;
            }}
            endpointRef={(id, el) => {
              sectionRefs.current[id] = el;
            }}
          />
        ))}

        {/* Error codes */}
        <section
          id="error-codes"
          ref={(el) => {
            sectionRefs.current["error-codes"] = el;
          }}
          className="scroll-mt-4"
        >
          <ErrorCodesSection />
        </section>

        {/* For staff: how the dashboard itself writes. Not the integrator's concern. */}
        {variant === "admin" && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
              <div className="text-gray-600 text-sm">
                <span className="font-medium text-gray-900">Nota:</span> la dashboard scrive tramite{" "}
                <span className="font-medium text-gray-900">Next.js Server Actions</span>, in{" "}
                <code className="rounded bg-white px-1 text-blue-700 text-xs">src/actions/</code>. ⚠️ Ognuna è un
                endpoint che qualunque browser autenticato può chiamare: per questo ciascuna controlla i permessi da sé,
                e ciò che non deve essere chiamabile — come l'invio degli eventi ai webhook — sta in{" "}
                <code className="rounded bg-white px-1 text-blue-700 text-xs">src/lib/</code>.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The machine-readable reference, for the public page: generated from the same entries. */
function OpenApiLink() {
  return (
    <a
      href="/api/openapi.json"
      className="inline-flex items-center gap-1.5 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
    >
      <Download className="size-3.5" aria-hidden />
      openapi.json
    </a>
  );
}
