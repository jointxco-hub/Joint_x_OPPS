import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { format, isToday } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Filter,
  MessageCircle,
  PackageSearch,
  PanelLeftOpen,
  Users,
  Waves,
} from "lucide-react";

const DEFAULT_FILTERS = {
  unread: false,
  risk: "all",
  department: "all",
  intent: "all",
};

const INTENT_LABELS = {
  quote_request: "Quote request",
  order_update: "Order update",
  artwork_request: "Artwork request",
  invoice_request: "Invoice request",
  delivery_request: "Delivery request",
  complaint: "Complaint",
  general_support: "General support",
  team_log: "Team log",
  unknown: "Unknown",
};

const DEPARTMENT_LABELS = {
  support: "Support",
  design: "Design",
  production: "Production",
  finance: "Finance",
  delivery: "Delivery",
  admin: "Admin",
};

export default function MetaWhatsAppInbox() {
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    setFilters({
      unread: searchParams.get("unread") === "1",
      risk: searchParams.get("risk") || "all",
      department: searchParams.get("department") || "all",
      intent: searchParams.get("intent") || "all",
    });
    setSearch(searchParams.get("q") || "");
    setSelectedConversationId(searchParams.get("conversation"));
  }, [searchParams]);

  const conversationsQuery = useQuery({
    queryKey: ["opps-conversations"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("opps_conversations")
        .select(`
          id, tenant_id, channel, wa_id, phone, display_name, linked_client_id, linked_order_id,
          last_message_at, last_message_preview, unread_count, status,
          opps_messages (
            id, direction, message_type, body, received_at, created_at,
            opps_message_intelligence ( intent, sentiment, risk_level, suggested_department, suggested_next_action, summary, created_at )
          )
        `)
        .eq("channel", "whatsapp")
        .order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) || conversations[0] || null;

  const selectedConversationMessages = useMemo(() => {
    const messages = selectedConversation?.opps_messages ?? [];
    return [...messages].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  }, [selectedConversation]);

  const updateQuery = (next) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value === null || value === undefined || value === "" || value === false || value === "all") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    });
    setSearchParams(params, { replace: true });
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const latestMessage = getLatestMessage(conversation);
      const intelligence = latestMessage?.opps_message_intelligence?.[0];
      const haystack = [conversation.display_name, conversation.phone, conversation.last_message_preview].join(" ").toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (filters.unread && Number(conversation.unread_count || 0) <= 0) return false;
      if (filters.risk !== "all" && (intelligence?.risk_level || "normal") !== filters.risk) return false;
      if (filters.department !== "all" && (intelligence?.suggested_department || "support") !== filters.department) return false;
      if (filters.intent !== "all" && (intelligence?.intent || "unknown") !== filters.intent) return false;
      return true;
    });
  }, [conversations, filters, search]);

  const todayInboundCount = useMemo(() => {
    return conversations.reduce((total, conversation) => {
      const messages = conversation.opps_messages || [];
      return total + messages.filter((message) => message.direction === "inbound" && isToday(new Date(message.created_at))).length;
    }, 0);
  }, [conversations]);

  const unreadConversations = conversations.filter((item) => Number(item.unread_count || 0) > 0).length;
  const highRiskMessages = conversations.filter((item) => getLatestMessage(item)?.opps_message_intelligence?.[0]?.risk_level === "high").length;
  const requestCounts = countRequests(conversations);
  const teamLogCount = conversations.filter((item) => getLatestMessage(item)?.opps_message_intelligence?.[0]?.intent === "team_log").length;

  const summarySignalsQuery = useQuery({
    queryKey: ["opps-daily-activity-signals"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("opps_daily_activity_signals")
        .select("signal_key, signal_value, signal_date")
        .order("signal_date", { ascending: false })
        .order("signal_value", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const signals = summarySignalsQuery.data ?? [];
  const selectedLatestMessage = selectedConversationMessages[selectedConversationMessages.length - 1];
  const selectedIntelligence = selectedLatestMessage?.opps_message_intelligence?.[0];

  if (!supabase) {
    return <EmptyState title="Supabase not configured" body="Set the Supabase environment variables to use the WhatsApp inbox." />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(26,122,94,0.14),_transparent_35%),linear-gradient(180deg,#f8faf8_0%,#ffffff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-slate-950 text-white shadow-[0_30px_80px_rgba(15,23,42,0.25)]">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
                <Waves className="h-3.5 w-3.5" /> Meta WhatsApp inbox
              </div>
              <h1 className="max-w-2xl text-3xl font-black tracking-tight md:text-5xl">Receiving-only message capture for OPPS visibility</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Verify Meta webhooks, store inbound WhatsApp events, and surface them for inbox, My Hub, and CIC triage. Phase 1 does not send messages or automate replies.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Metric label="Inbound today" value={todayInboundCount} icon={MessageCircle} />
                <Metric label="Unread conversations" value={unreadConversations} icon={BadgeCheck} />
                <Metric label="High-risk" value={highRiskMessages} icon={AlertTriangle} tone="amber" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
              <SummaryCard label="Quote / order / artwork requests" value={requestCounts.quote_request + requestCounts.order_update + requestCounts.artwork_request} icon={PackageSearch} />
              <SummaryCard label="Finance / delivery / support" value={requestCounts.invoice_request + requestCounts.delivery_request + requestCounts.general_support + requestCounts.complaint} icon={Users} />
              <SummaryCard label="Team-log style messages" value={teamLogCount} icon={PanelLeftOpen} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.95fr_0.7fr]">
          <div className="rounded-[1.75rem] border border-border bg-card/95 p-4 shadow-sm backdrop-blur xl:col-span-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Conversation list</h2>
                <p className="text-xs text-muted-foreground">Sorted by most recent activity</p>
              </div>
              <Badge variant="secondary" className="rounded-full">{filteredConversations.length}</Badge>
            </div>
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, preview" className="rounded-2xl" />
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2">
                  <TogglePill active={filters.unread} onClick={() => {
                    const unread = !filters.unread;
                    setFilters((current) => ({ ...current, unread }));
                    updateQuery({ unread, q: search, risk: filters.risk, department: filters.department, intent: filters.intent, conversation: selectedConversationId });
                  }} icon={Filter} label="Unread" />
                  <Select value={filters.risk} onValueChange={(value) => {
                    setFilters((current) => ({ ...current, risk: value }));
                    updateQuery({ unread: filters.unread, q: search, risk: value, department: filters.department, intent: filters.intent, conversation: selectedConversationId });
                  }}>
                    <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Risk" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All risk</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filters.department} onValueChange={(value) => {
                    setFilters((current) => ({ ...current, department: value }));
                    updateQuery({ unread: filters.unread, q: search, risk: filters.risk, department: value, intent: filters.intent, conversation: selectedConversationId });
                  }}>
                    <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Department" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filters.intent} onValueChange={(value) => {
                    setFilters((current) => ({ ...current, intent: value }));
                    updateQuery({ unread: filters.unread, q: search, risk: filters.risk, department: filters.department, intent: value, conversation: selectedConversationId });
                  }}>
                    <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Intent" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All intents</SelectItem>
                      {Object.entries(INTENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                {filteredConversations.map((conversation) => {
                  const latestMessage = conversation.opps_messages?.[0];
                  const intelligence = latestMessage?.opps_message_intelligence?.[0];
                  const isActive = selectedConversation?.id === conversation.id;
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => {
                        setSelectedConversationId(conversation.id);
                        updateQuery({ unread: filters.unread, q: search, risk: filters.risk, department: filters.department, intent: filters.intent, conversation: conversation.id });
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${isActive ? "border-emerald-200 bg-emerald-50 shadow-sm" : "border-border bg-background hover:border-emerald-100 hover:bg-secondary/40"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-sm font-bold text-white">
                          {(conversation.display_name || conversation.phone || "W").charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-foreground">{conversation.display_name || "Untitled conversation"}</p>
                            {!!conversation.unread_count && <Badge className="rounded-full bg-emerald-600 text-white">{conversation.unread_count}</Badge>}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{conversation.phone || conversation.wa_id || "No phone saved"}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{conversation.last_message_preview || latestMessage?.body || "No message preview"}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide">
                            <Badge variant="outline" className="rounded-full">{INTENT_LABELS[intelligence?.intent || "unknown"]}</Badge>
                            <Badge variant={intelligence?.risk_level === "high" ? "destructive" : "secondary"} className="rounded-full">{intelligence?.risk_level || "normal"} risk</Badge>
                            <Badge variant="outline" className="rounded-full">{DEPARTMENT_LABELS[intelligence?.suggested_department || "support"]}</Badge>
                            {conversation.linked_order_id && <Badge variant="outline" className="rounded-full">Order linked</Badge>}
                          </div>
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  );
                })}
                {filteredConversations.length === 0 && <EmptyState title="No conversations yet" body="Webhook-captured WhatsApp conversations will appear here once Meta starts delivering events." compact />}
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card/95 p-4 shadow-sm backdrop-blur xl:col-span-1">
            {selectedConversation ? (
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{selectedConversation.display_name || "Conversation"}</h2>
                    <p className="text-sm text-muted-foreground">{selectedConversation.phone || selectedConversation.wa_id || "No phone saved"}</p>
                  </div>
                  <div className="flex flex-col gap-2 text-right">
                    <Badge variant="outline" className="rounded-full">{selectedConversation.status}</Badge>
                    <span className="text-xs text-muted-foreground">{selectedConversation.last_message_at ? format(new Date(selectedConversation.last_message_at), "d MMM yyyy, HH:mm") : "No recent message"}</span>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <MiniStat label="Linked order" value={selectedConversation.linked_order_id || "None"} />
                  <MiniStat label="Linked client" value={selectedConversation.linked_client_id || "None"} />
                  <MiniStat label="Unread" value={selectedConversation.unread_count || 0} />
                </div>

                <div className="space-y-3 rounded-3xl border border-border bg-secondary/20 p-4">
                  <p className="text-sm font-semibold text-foreground">Message history</p>
                  <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
                    {selectedConversationMessages.map((message) => (
                      <div key={message.id} className={`rounded-2xl border p-3 ${message.direction === "inbound" ? "border-emerald-100 bg-white" : "border-border bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span>{message.direction}</span>
                          <span>{message.created_at ? format(new Date(message.created_at), "d MMM, HH:mm") : "Now"}</span>
                        </div>
                        <p className="mt-2 text-sm text-foreground">{message.body || message.message_type || "Status update"}</p>
                        {message.opps_message_intelligence?.[0] && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline" className="rounded-full">{message.opps_message_intelligence[0].intent || "unknown"}</Badge>
                            <Badge variant={message.opps_message_intelligence[0].risk_level === "high" ? "destructive" : "secondary"} className="rounded-full">{message.opps_message_intelligence[0].risk_level} risk</Badge>
                          </div>
                        )}
                      </div>
                    ))}
                    {selectedConversationMessages.length === 0 && <EmptyState title="No messages yet" body="Inbound messages will populate this thread after webhook capture." compact />}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title="Select a conversation" body="Pick a conversation to inspect its history and intelligence." />
            )}
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card/95 p-4 shadow-sm backdrop-blur xl:col-span-1">
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Intelligence summary</h2>
                <p className="text-xs text-muted-foreground">Rule-based only for Phase 1</p>
              </div>
              <div className="rounded-3xl border border-border bg-slate-50 p-4">
                <p className="text-sm font-semibold text-foreground">{INTENT_LABELS[selectedIntelligence?.intent || "unknown"]}</p>
                <p className="mt-2 text-sm text-muted-foreground">{selectedIntelligence?.summary || selectedConversation?.last_message_preview || "No summary available."}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant={selectedIntelligence?.risk_level === "high" ? "destructive" : "secondary"} className="rounded-full">{selectedIntelligence?.risk_level || "normal"} risk</Badge>
                  <Badge variant="outline" className="rounded-full">{DEPARTMENT_LABELS[selectedIntelligence?.suggested_department || "support"]}</Badge>
                </div>
                <div className="mt-4 rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                  <p className="font-semibold">Suggested next action</p>
                  <p className="mt-1">{selectedIntelligence?.suggested_next_action || "Review manually and assign."}</p>
                </div>
              </div>

              <div className="grid gap-3">
                <CicCard label="Inbound today" value={todayInboundCount} />
                <CicCard label="Unread conversations" value={unreadConversations} />
                <CicCard label="High-risk messages" value={highRiskMessages} tone="amber" />
                <CicCard label="Team-log messages" value={teamLogCount} />
              </div>

              <div className="rounded-3xl border border-border bg-background p-4">
                <label className="mb-2 block text-sm font-semibold text-foreground">Reply sending disabled in Phase 1</label>
                <Textarea disabled value="Reply sending disabled in Phase 1" className="min-h-[110px] rounded-2xl bg-secondary/40" />
                <Button disabled className="mt-3 w-full rounded-2xl">Disabled draft reply</Button>
              </div>

              <div className="rounded-3xl border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">Daily activity signals</p>
                <div className="mt-3 space-y-2 text-sm">
                  {signals.slice(0, 6).map((signal) => (
                    <div key={`${signal.signal_key}-${signal.signal_date}`} className="flex items-center justify-between rounded-2xl bg-secondary/40 px-3 py-2">
                      <span className="capitalize text-muted-foreground">{signal.signal_key.replace(/_/g, " ")}</span>
                      <span className="font-semibold text-foreground">{signal.signal_value}</span>
                    </div>
                  ))}
                  {signals.length === 0 && <p className="text-muted-foreground">No signals yet.</p>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="rounded-[1.5rem] border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Phase 1 only captures incoming Meta WhatsApp events. No auto reply, outbound send, discount, refund, delivery promise, or payment confirmation behavior exists here.
        </footer>
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = "emerald" }) {
  const toneClasses = tone === "amber" ? "border-amber-400/20 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/5 text-white";
  return (
    <div className={`min-w-[160px] rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/70">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4 text-white">
      <Icon className="h-5 w-5 text-emerald-200" />
      <p className="mt-3 text-2xl font-black">{value}</p>
      <p className="mt-1 text-sm text-slate-300">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CicCard({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${tone === "amber" ? "border-amber-200 bg-amber-50" : "border-border bg-secondary/20"}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function TogglePill({ active, onClick, icon: Icon, label }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} onClick={onClick} className="rounded-2xl">
      <Icon className="mr-2 h-4 w-4" /> {label}
    </Button>
  );
}

function EmptyState({ title, body, compact = false }) {
  return (
    <div className={`rounded-3xl border border-dashed border-border bg-secondary/20 ${compact ? "px-4 py-5" : "px-6 py-10 text-center"}`}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function countRequests(conversations) {
  return conversations.reduce(
    (totals, conversation) => {
      const intent = conversation.opps_messages?.[0]?.opps_message_intelligence?.[0]?.intent || "unknown";
      if (totals[intent] !== undefined) totals[intent] += 1;
      return totals;
    },
    {
      quote_request: 0,
      order_update: 0,
      artwork_request: 0,
      invoice_request: 0,
      delivery_request: 0,
      complaint: 0,
      general_support: 0,
      team_log: 0,
      unknown: 0,
    }
  );
}

function getLatestMessage(conversation) {
  const messages = conversation?.opps_messages || [];
  return [...messages].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
}

