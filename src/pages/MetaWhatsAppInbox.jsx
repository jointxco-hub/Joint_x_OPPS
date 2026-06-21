import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Filter,
  MessageCircle,
  PackageSearch,
  PanelLeftOpen,
  Users,
  Waves,
  X,
} from "lucide-react";

const DEFAULT_FILTERS = {
  unread: false,
  risk: "all",
  department: "all",
  intent: "all",
  status: "all",
};

const INTENT_LABELS = {
  quote_request: "Quote request",
  order_update: "Order update",
  artwork_request: "Artwork request",
  invoice_request: "Invoice request",
  payment_query: "Payment query",
  delivery_request: "Delivery request",
  complaint: "Complaint",
  general_support: "General support",
  team_log: "Team log",
  production_update: "Production update",
  design_update: "Design update",
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

const ROLE_VIEW_LABELS = {
  all: "All conversations",
  cic: "CIC / Admin",
  support: "Support",
  design: "Design",
  production: "Production",
  finance: "Finance",
  delivery: "Delivery",
  team_logs: "Team Logs",
};

export default function MetaWhatsAppInbox() {
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [departmentDraft, setDepartmentDraft] = useState("support");
  const [statusDraft, setStatusDraft] = useState("open");
  const [orderDraft, setOrderDraft] = useState("");
  const [clientDraft, setClientDraft] = useState("");
  const [internalNoteDraft, setInternalNoteDraft] = useState("");
  const [mobileView, setMobileView] = useState("list");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [roleView, setRoleView] = useState("all");

  useEffect(() => {
    setFilters({
      unread: searchParams.get("unread") === "1",
      risk: searchParams.get("risk") || "all",
      department: searchParams.get("department") || "all",
      intent: searchParams.get("intent") || "all",
      status: searchParams.get("status") || "all",
    });
    setRoleView(searchParams.get("role") || "all");
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
          id, tenant_id, channel, wa_id, phone, display_name, linked_client_id, linked_order_id, assigned_department,
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

  const ordersQuery = useQuery({
    queryKey: ["opps-inbox-orders"],
    enabled: !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, client_name, status, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const clientsQuery = useQuery({
    queryKey: ["opps-inbox-clients"],
    enabled: !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, phone, whatsapp_name, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const conversations = conversationsQuery.data ?? [];
  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) || conversations[0] || null;
  const orders = ordersQuery.data ?? [];
  const clients = clientsQuery.data ?? [];

  const selectedConversationMessages = useMemo(() => {
    const messages = selectedConversation?.opps_messages ?? [];
    return [...messages].sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
  }, [selectedConversation]);

  const conversationNotesQuery = useQuery({
    queryKey: ["opps-conversation-notes", selectedConversation?.id],
    enabled: !!selectedConversation?.id && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opps_conversation_notes")
        .select("id, conversation_id, note_type, note, created_by, created_at")
        .eq("conversation_id", selectedConversation.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

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

  useEffect(() => {
    if (!selectedConversation) return;
    const latestIntelligence = getLatestIntelligence(selectedConversation);
    setDepartmentDraft(selectedConversation.assigned_department || latestIntelligence?.suggested_department || "support");
    setStatusDraft(selectedConversation.status || "open");
    setOrderDraft(selectedConversation.linked_order_id || "");
    setClientDraft(selectedConversation.linked_client_id || "");
    setInternalNoteDraft("");
  }, [
    selectedConversation?.id,
    selectedConversation?.assigned_department,
    selectedConversation?.status,
    selectedConversation?.linked_order_id,
    selectedConversation?.linked_client_id,
  ]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const latestMessage = getLatestMessage(conversation);
      const intelligence = latestMessage?.opps_message_intelligence?.[0];
      const haystack = [conversation.display_name, conversation.phone, conversation.last_message_preview].join(" ").toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (filters.unread && Number(conversation.unread_count || 0) <= 0) return false;
      if (filters.risk !== "all" && (intelligence?.risk_level || "normal") !== filters.risk) return false;
      if (filters.department !== "all" && (conversation.assigned_department || intelligence?.suggested_department || "support") !== filters.department) return false;
      if (filters.intent !== "all" && (intelligence?.intent || "unknown") !== filters.intent) return false;
      if (filters.status !== "all" && (conversation.status || "open") !== filters.status) return false;
      if (!matchesRoleView(conversation, roleView)) return false;
      return true;
    });
  }, [conversations, filters, search, roleView]);

  const inboxStats = useMemo(() => summarizeToday(conversations), [conversations]);
  const unreadConversations = conversations.filter((item) => Number(item.unread_count || 0) > 0).length;
  const todayInboundCount = inboxStats.inbound;
  const highRiskMessages = inboxStats.highRisk;
  const requestCounts = inboxStats.intentCounts;
  const teamLogCount = inboxStats.teamLog;
  const roleWorkload = useMemo(() => summarizeRoleWorkload(conversations), [conversations]);
  const selectedLatestMessage = selectedConversationMessages[selectedConversationMessages.length - 1];
  const selectedIntelligence = selectedLatestMessage?.opps_message_intelligence?.[0];
  const selectedConversationNotes = conversationNotesQuery.data ?? [];

  const updateConversationMutation = useMutation({
    mutationFn: async ({ conversationId, patch }) => {
      const { error } = await supabase.from("opps_conversations").update(patch).eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["opps-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["opps-conversation-notes", selectedConversation?.id] });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async ({ conversationId, note }) => {
      const { data: authUser } = await supabase.auth.getUser();
      const { error } = await supabase.from("opps_conversation_notes").insert({
        conversation_id: conversationId,
        tenant_id: selectedConversation?.tenant_id || null,
        note_type: "internal",
        note,
        created_by: authUser?.user?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setInternalNoteDraft("");
      await queryClient.invalidateQueries({ queryKey: ["opps-conversations"] });
      await queryClient.invalidateQueries({ queryKey: ["opps-conversation-notes", selectedConversation?.id] });
    },
  });

  const saveConversationLinkMutation = useMutation({
    mutationFn: async ({ conversationId, patch }) => {
      const { error } = await supabase.from("opps_conversations").update(patch).eq("id", conversationId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["opps-conversations"] });
    },
  });

  const markConversationRead = () => {
    if (!selectedConversation) return;
    updateConversationMutation.mutate({ conversationId: selectedConversation.id, patch: { unread_count: 0 } });
  };

  const setConversationStatus = (status) => {
    if (!selectedConversation) return;
    updateConversationMutation.mutate({ conversationId: selectedConversation.id, patch: { status } });
    setStatusDraft(status);
  };

  const saveDepartment = () => {
    if (!selectedConversation) return;
    updateConversationMutation.mutate({ conversationId: selectedConversation.id, patch: { assigned_department: departmentDraft } });
  };

  const saveLinks = () => {
    if (!selectedConversation) return;
    saveConversationLinkMutation.mutate({
      conversationId: selectedConversation.id,
      patch: {
        linked_order_id: orderDraft || null,
        linked_client_id: clientDraft || null,
      },
    });
  };

  const addInternalNote = () => {
    if (!selectedConversation || !internalNoteDraft.trim()) return;
    addNoteMutation.mutate({
      conversationId: selectedConversation.id,
      note: internalNoteDraft.trim(),
    });
  };

  if (!supabase) {
    return <EmptyState title="Supabase not configured" body="Set the Supabase environment variables to use the WhatsApp inbox." />;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(26,122,94,0.14),_transparent_35%),linear-gradient(180deg,#f8faf8_0%,#ffffff_100%)]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
        <header className="md:hidden">
          <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white shadow-lg">
            <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Meta WhatsApp</p><h1 className="text-lg font-bold">Inbox</h1></div><Waves className="h-5 w-5 text-emerald-300" /></div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center"><CompactMetric label="Unread" value={unreadConversations} /><CompactMetric label="High risk" value={highRiskMessages} /><CompactMetric label="My role / open" value={roleView === "all" || roleView === "cic" ? roleWorkload.open : roleWorkload[roleView] || 0} /></div>
            <button type="button" onClick={() => setShowAllSignals((value) => !value)} className="mt-3 flex w-full items-center justify-between text-xs font-medium text-slate-300">Today&apos;s signals {showAllSignals ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
            {showAllSignals && <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-200"><span>Support {inboxStats.support}</span><span>Design {inboxStats.design}</span><span>Production {inboxStats.production}</span><span>Finance {inboxStats.finance}</span><span>Delivery {inboxStats.delivery}</span><span>Team logs {teamLogCount}</span></div>}
          </div>
        </header>
        <header className="hidden overflow-hidden rounded-[2rem] border border-emerald-100 bg-slate-950 text-white shadow-[0_30px_80px_rgba(15,23,42,0.25)] md:block">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
                <Waves className="h-3.5 w-3.5" /> Meta WhatsApp inbox
              </div>
              <h1 className="max-w-2xl text-3xl font-black tracking-tight md:text-5xl">Receiving-only message capture for OPPS visibility</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 md:text-base">
                Verify Meta webhooks, store inbound WhatsApp events, and surface them for inbox, My Hub, and CIC triage. Phase 1 does not send messages or automate replies.
              </p>
              <div className="mt-4 max-w-sm"><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-emerald-100">Role view</label><Select value={roleView} onValueChange={(value) => { setRoleView(value); updateQuery({ role: value }); }}><SelectTrigger className="rounded-xl border-white/20 bg-white/10 text-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_VIEW_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Metric label="Inbound today" value={todayInboundCount} icon={MessageCircle} />
                <Metric label="Unread conversations" value={unreadConversations} icon={BadgeCheck} />
                <Metric label="High-risk" value={highRiskMessages} icon={AlertTriangle} tone="amber" />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
              <SummaryCard label="Quote / order / artwork requests" value={requestCounts.quote_request + requestCounts.order_update + requestCounts.production_update + requestCounts.artwork_request + requestCounts.design_update} icon={PackageSearch} />
              <SummaryCard label="Finance / delivery / support" value={requestCounts.invoice_request + requestCounts.payment_query + requestCounts.delivery_request + requestCounts.general_support + requestCounts.complaint} icon={Users} />
              <SummaryCard label="Team-log style messages" value={teamLogCount} icon={PanelLeftOpen} />
            </div>
          </div>
        </header>

        <div className="hidden grid-cols-7 gap-2 rounded-2xl border border-border bg-card p-3 md:grid">
          <WorkloadCard label="Support open" value={roleWorkload.support} /><WorkloadCard label="Design open" value={roleWorkload.design} /><WorkloadCard label="Production open" value={roleWorkload.production} /><WorkloadCard label="Finance open" value={roleWorkload.finance} /><WorkloadCard label="Delivery open" value={roleWorkload.delivery} /><WorkloadCard label="High-risk open" value={roleWorkload.highRisk} tone="amber" /><WorkloadCard label="Team logs today" value={teamLogCount} />
        </div>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.95fr_0.7fr]">
          <div className={`rounded-[1.75rem] border border-border bg-card/95 p-3 shadow-sm backdrop-blur md:p-4 xl:col-span-1 ${mobileView === "conversation" ? "hidden md:block" : ""}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Conversation list</h2>
                <p className="text-xs text-muted-foreground">Sorted by most recent activity</p>
              </div>
              <Badge variant="secondary" className="rounded-full">{filteredConversations.length}</Badge>
            </div>
            <div className="space-y-3">
              <MobileFilterBar filters={filters} setFilters={setFilters} updateQuery={updateQuery} search={search} setSearch={setSearch} selectedConversationId={selectedConversationId} showMore={showMoreFilters} setShowMore={setShowMoreFilters} roleView={roleView} setRoleView={setRoleView} />
              <div className="hidden gap-2 md:grid md:grid-cols-2 xl:grid-cols-1">
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
                  const latestMessage = getLatestMessage(conversation);
                  const intelligence = getLatestIntelligence(conversation);
                  const isActive = selectedConversation?.id === conversation.id;
                  const displayDepartment = conversation.assigned_department || intelligence?.suggested_department || "support";
                  const actionNeeded = needsAction(conversation);
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => {
                        setSelectedConversationId(conversation.id);
                        setMobileView("conversation");
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
                            {actionNeeded && <Badge className="rounded-full bg-amber-500 text-amber-950">Needs action</Badge>}
                            <Badge variant="outline" className="rounded-full">{INTENT_LABELS[intelligence?.intent || "unknown"]}</Badge>
                            <Badge variant={intelligence?.risk_level === "high" ? "destructive" : "secondary"} className="rounded-full">{intelligence?.risk_level || "normal"} risk</Badge>
                            <Badge variant="outline" className="rounded-full">{conversation.assigned_department ? `Assigned ${DEPARTMENT_LABELS[displayDepartment] || displayDepartment}` : `Suggested ${DEPARTMENT_LABELS[displayDepartment] || displayDepartment}`}</Badge>
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

          <div className={`rounded-[1.75rem] border border-border bg-card/95 p-3 shadow-sm backdrop-blur md:p-4 xl:col-span-1 ${mobileView === "list" ? "hidden md:block" : ""}`}>
            {selectedConversation ? (
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
                  <div className="flex items-start gap-2">
                    <Button variant="ghost" size="icon" onClick={() => setMobileView("list")} className="-ml-2 mt-0.5 rounded-xl md:hidden" aria-label="Back to chats"><ArrowLeft className="h-4 w-4" /></Button>
                    <div>
                    <h2 className="text-xl font-semibold text-foreground">{selectedConversation.display_name || "Conversation"}</h2>
                    <p className="text-sm text-muted-foreground">{selectedConversation.phone || selectedConversation.wa_id || "No phone saved"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 text-right">
                    <Button variant="outline" onClick={() => setShowActions(true)} className="rounded-xl md:hidden">Actions</Button>
                    <Badge variant="outline" className="rounded-full">{selectedConversation.status}</Badge>
                    <span className="text-xs text-muted-foreground">{selectedConversation.last_message_at ? format(new Date(selectedConversation.last_message_at), "d MMM yyyy, HH:mm") : "No recent message"}</span>
                  </div>
                </div>

                <div className="hidden gap-3 md:grid md:grid-cols-3">
                  <MiniStat label="Linked order" value={selectedConversation.linked_order_id || "None"} />
                  <MiniStat label="Linked client" value={selectedConversation.linked_client_id || "None"} />
                  <MiniStat label="Unread" value={selectedConversation.unread_count || 0} />
                </div>

                <div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline" className="rounded-full">Assigned: {DEPARTMENT_LABELS[selectedConversation.assigned_department] || "Unassigned"}</Badge><Badge variant="secondary" className="rounded-full">Suggested: {DEPARTMENT_LABELS[selectedIntelligence?.suggested_department || "support"] || "Support"}</Badge>{needsAction(selectedConversation) && <Badge className="rounded-full bg-amber-500 text-amber-950">Needs action</Badge>}</div>

                <div className="hidden flex-wrap gap-2 md:flex">
                  <Button onClick={markConversationRead} className="rounded-2xl">Mark as read</Button>
                  <Button variant={statusDraft === "open" ? "default" : "outline"} onClick={() => setConversationStatus("open")} className="rounded-2xl">Mark open</Button>
                  <Button variant={statusDraft === "closed" ? "default" : "outline"} onClick={() => setConversationStatus("closed")} className="rounded-2xl">Mark closed</Button>
                </div>

                <div className="hidden gap-3 rounded-3xl border border-border bg-secondary/20 p-4 md:grid md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">Manual department</p>
                    <Select value={departmentDraft} onValueChange={setDepartmentDraft}>
                      <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Assign department" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button onClick={saveDepartment} className="rounded-2xl">Save department</Button>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">Link conversation</p>
                    <Select value={orderDraft || "none"} onValueChange={(value) => setOrderDraft(value === "none" ? "" : value)}>
                      <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Link order" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No order linked</SelectItem>
                        {orders.slice(0, 100).map((order) => <SelectItem key={order.id} value={order.id}>{formatOrderLabel(order)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={clientDraft || "none"} onValueChange={(value) => setClientDraft(value === "none" ? "" : value)}>
                      <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Link client" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No client linked</SelectItem>
                        {clients.slice(0, 100).map((client) => <SelectItem key={client.id} value={client.id}>{formatClientLabel(client)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button onClick={saveLinks} className="rounded-2xl">Link conversation</Button>
                  </div>
                </div>

                <div className="space-y-3 rounded-3xl border border-border bg-secondary/20 p-3 md:p-4">
                  <p className="text-sm font-semibold text-foreground">Message history</p>
                  <div className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
                    {selectedConversationMessages.map((message) => (
                      <div key={message.id} className={`rounded-2xl border p-3 ${message.opps_message_intelligence?.[0]?.intent === "team_log" ? "border-slate-300 bg-slate-100" : message.direction === "inbound" ? "border-emerald-100 bg-white" : "border-border bg-slate-50"}`}>
                        <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span>{message.direction}</span>
                          <span>{message.created_at ? format(new Date(message.created_at), "d MMM, HH:mm") : "Now"}</span>
                        </div>
                        <p className="mt-2 text-sm text-foreground">{message.body || message.message_type || "Status update"}</p>
                        {message.opps_message_intelligence?.[0] && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline" className="rounded-full">{INTENT_LABELS[message.opps_message_intelligence[0].intent] || "Unknown"}</Badge>
                            <Badge variant={message.opps_message_intelligence[0].risk_level === "high" ? "destructive" : "secondary"} className="rounded-full">{message.opps_message_intelligence[0].risk_level} risk</Badge>
                          </div>
                        )}
                      </div>
                    ))}
                    {selectedConversationMessages.length === 0 && <EmptyState title="No messages yet" body="Inbound messages will populate this thread after webhook capture." compact />}
                  </div>
                </div>

                <div className="hidden rounded-3xl border border-border bg-background p-4 md:block">
                  <p className="text-sm font-semibold text-foreground">Internal notes</p>
                  <div className="mt-3 space-y-2">
                    <Textarea value={internalNoteDraft} onChange={(event) => setInternalNoteDraft(event.target.value)} placeholder="Add an internal note for Ops, CIC, or the next shift..." className="min-h-[100px] rounded-2xl" />
                    <Button onClick={addInternalNote} className="rounded-2xl">Add internal note</Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {selectedConversationNotes.map((note) => (
                      <div key={note.id} className="rounded-2xl border border-border bg-secondary/30 p-3">
                        <p className="text-sm text-foreground">{note.note}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {note.note_type} • {note.created_at ? format(new Date(note.created_at), "d MMM yyyy, HH:mm") : "Now"}
                        </p>
                      </div>
                    ))}
                    {selectedConversationNotes.length === 0 && <p className="text-sm text-muted-foreground">No internal notes yet.</p>}
                  </div>
                </div>

                <div className="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-1">
                  <CicCard label="Support messages today" value={inboxStats.support} />
                  <CicCard label="Design signals today" value={inboxStats.design} />
                  <CicCard label="Production signals today" value={inboxStats.production} />
                  <CicCard label="Finance signals today" value={inboxStats.finance} />
                  <CicCard label="Delivery signals today" value={inboxStats.delivery} />
                  <CicCard label="Team logs today" value={inboxStats.teamLog} />
                  <CicCard label="High-risk issues today" value={inboxStats.highRisk} tone="amber" />
                </div>
              </div>
            ) : (
              <EmptyState title="Select a conversation" body="Pick a conversation to inspect its history and intelligence." />
            )}
          </div>

          <div className="hidden rounded-[1.75rem] border border-border bg-card/95 p-4 shadow-sm backdrop-blur md:block xl:col-span-1">
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

              <div className="rounded-3xl border border-border bg-background p-4">
                <label className="mb-2 block text-sm font-semibold text-foreground">Reply sending disabled in Phase 1</label>
                <Textarea disabled value="Reply sending disabled in Phase 1" className="min-h-[110px] rounded-2xl bg-secondary/40" />
                <Button disabled className="mt-3 w-full rounded-2xl">Disabled draft reply</Button>
              </div>
            </div>
          </div>
        </section>

        {showActions && selectedConversation && (
          <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 p-3 md:hidden" role="dialog" aria-modal="true" aria-label="Conversation actions">
            <div className="max-h-[88vh] w-full overflow-y-auto rounded-[1.75rem] bg-background p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between"><div><p className="text-base font-bold">Conversation actions</p><p className="text-xs text-muted-foreground">Internal OPPS coordination only</p></div><Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowActions(false)}><X className="h-5 w-5" /></Button></div>
              <div className="grid grid-cols-2 gap-2"><Button onClick={markConversationRead} className="rounded-xl">Mark as read</Button><Button variant="outline" onClick={() => setConversationStatus(statusDraft === "open" ? "closed" : "open")} className="rounded-xl">{statusDraft === "open" ? "Close" : "Reopen"}</Button></div>
              <div className="mt-4 space-y-2 rounded-2xl bg-secondary/35 p-3"><label className="text-sm font-semibold">Assign department</label><Select value={departmentDraft} onValueChange={setDepartmentDraft}><SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(DEPARTMENT_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button onClick={saveDepartment} className="w-full rounded-xl">Save assignment</Button></div>
              <div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(DEPARTMENT_LABELS).map(([value, label]) => <Button key={value} variant="outline" className="rounded-xl text-xs" onClick={() => { setDepartmentDraft(value); updateConversationMutation.mutate({ conversationId: selectedConversation.id, patch: { assigned_department: value } }); }}>{`Assign ${label}`}</Button>)}</div>
              <details className="mt-3 rounded-2xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">More actions: links and internal note</summary><div className="mt-3 space-y-3"><Select value={orderDraft || "none"} onValueChange={(value) => setOrderDraft(value === "none" ? "" : value)}><SelectTrigger className="rounded-xl"><SelectValue placeholder="Link order" /></SelectTrigger><SelectContent><SelectItem value="none">No order linked</SelectItem>{orders.slice(0, 100).map((order) => <SelectItem key={order.id} value={order.id}>{formatOrderLabel(order)}</SelectItem>)}</SelectContent></Select><Select value={clientDraft || "none"} onValueChange={(value) => setClientDraft(value === "none" ? "" : value)}><SelectTrigger className="rounded-xl"><SelectValue placeholder="Link client" /></SelectTrigger><SelectContent><SelectItem value="none">No client linked</SelectItem>{clients.slice(0, 100).map((client) => <SelectItem key={client.id} value={client.id}>{formatClientLabel(client)}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={saveLinks} className="w-full rounded-xl">Save links</Button><Textarea value={internalNoteDraft} onChange={(event) => setInternalNoteDraft(event.target.value)} placeholder="Add internal note..." className="min-h-[84px] rounded-xl" /><Button onClick={addInternalNote} className="w-full rounded-xl">Add internal note</Button></div></details>
            </div>
          </div>
        )}

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

function CompactMetric({ label, value }) {
  return <div className="rounded-xl bg-white/10 px-2 py-2"><p className="text-lg font-bold leading-none">{value}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-slate-300">{label}</p></div>;
}

function MobileFilterBar({ filters, setFilters, updateQuery, search, setSearch, selectedConversationId, showMore, setShowMore, roleView, setRoleView }) {
  const setFilter = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    updateQuery({ unread: next.unread, risk: next.risk, department: next.department, intent: next.intent, status: next.status, q: search, conversation: selectedConversationId });
  };
  const chip = (label, active, onClick) => <button type="button" onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${active ? "bg-emerald-600 text-white" : "bg-secondary text-muted-foreground"}`}>{label}</button>;
  const changeRole = (value) => { setRoleView(value); updateQuery({ role: value }); };
  return <div className="space-y-2 md:hidden"><Input value={search} onChange={(event) => { setSearch(event.target.value); updateQuery({ q: event.target.value, unread: filters.unread, risk: filters.risk, department: filters.department, intent: filters.intent, status: filters.status, role: roleView, conversation: selectedConversationId }); }} placeholder="Search chats" className="h-9 rounded-xl" /><div className="flex gap-2 overflow-x-auto pb-1">{chip("All", roleView === "all" && !filters.unread && filters.risk === "all" && filters.department === "all" && filters.intent === "all" && filters.status === "all", () => { changeRole("all"); setFilter({ unread: false, risk: "all", department: "all", intent: "all", status: "all" }); })}{chip("Mine / Role", roleView !== "all", () => setShowMore(!showMore))}{chip("Unread", filters.unread, () => setFilter({ unread: !filters.unread }))}{chip("High Risk", filters.risk === "high", () => setFilter({ risk: filters.risk === "high" ? "all" : "high" }))}{chip("More", showMore, () => setShowMore(!showMore))}</div>{showMore && <div className="space-y-2 rounded-xl border border-border p-2"><Select value={roleView} onValueChange={changeRole}><SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder="Role view" /></SelectTrigger><SelectContent>{Object.entries(ROLE_VIEW_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><div className="flex flex-wrap gap-2">{chip("Support", filters.department === "support", () => setFilter({ department: filters.department === "support" ? "all" : "support" }))}{chip("Quotes", filters.intent === "quote_request", () => setFilter({ intent: filters.intent === "quote_request" ? "all" : "quote_request" }))}{["design", "production", "finance", "delivery"].map((value) => chip(DEPARTMENT_LABELS[value], filters.department === value, () => setFilter({ department: filters.department === value ? "all" : value })))}{chip("Team Logs", filters.intent === "team_log", () => setFilter({ intent: filters.intent === "team_log" ? "all" : "team_log" }))}{chip("Closed", filters.status === "closed", () => setFilter({ status: filters.status === "closed" ? "all" : "closed" }))}</div></div>}</div>;
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

function WorkloadCard({ label, value, tone }) {
  return <div className={`rounded-xl px-2 py-2 ${tone === "amber" ? "bg-amber-50 text-amber-950" : "bg-secondary/50"}`}><p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
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

function getLatestIntelligence(conversation) {
  return getLatestMessage(conversation)?.opps_message_intelligence?.[0] || null;
}

function needsAction(conversation) {
  const intelligence = getLatestIntelligence(conversation);
  return Number(conversation?.unread_count || 0) > 0 || conversation?.status === "open" || intelligence?.risk_level === "high" || !conversation?.assigned_department || intelligence?.intent === "unknown" || !!intelligence?.suggested_next_action;
}

function matchesRoleView(conversation, roleView) {
  if (roleView === "all" || roleView === "cic") return true;
  const intelligence = getLatestIntelligence(conversation);
  const department = conversation.assigned_department || intelligence?.suggested_department;
  const intent = intelligence?.intent || "unknown";
  const text = [conversation.last_message_preview, ...(conversation.opps_messages || []).map((message) => message.body)].filter(Boolean).join(" ").toLowerCase();
  if (roleView === "team_logs") return intent === "team_log" || /\b(logged in|done|finished|prepared|printed|packed|sent|delivered|blocker|blocking|daily update)\b/.test(text);
  if (department === roleView) return true;
  const intents = { support: ["general_support", "quote_request", "complaint", "unknown"], design: ["artwork_request", "design_update"], production: ["production_update", "order_update"], finance: ["invoice_request", "payment_query"], delivery: ["delivery_request"] };
  const keywords = { design: /\b(dtf|artwork|design|prep)\b/, production: /\b(printed|packed|prepared|printing|order movement)\b/, finance: /\b(payment received|proof of payment|balance|invoice|payment)\b/, delivery: /\b(paxi|courier guy|courier|collected|collection|tracking|address)\b/ };
  return intents[roleView]?.includes(intent) || keywords[roleView]?.test(text) || false;
}

function summarizeRoleWorkload(conversations) {
  const counts = { open: 0, support: 0, design: 0, production: 0, finance: 0, delivery: 0, highRisk: 0 };
  conversations.forEach((conversation) => {
    if (conversation.status === "closed") return;
    counts.open += 1;
    if (getLatestIntelligence(conversation)?.risk_level === "high") counts.highRisk += 1;
    ["support", "design", "production", "finance", "delivery"].forEach((role) => { if (matchesRoleView(conversation, role)) counts[role] += 1; });
  });
  return counts;
}

function summarizeToday(conversations) {
  const intentCounts = {
    quote_request: 0,
    order_update: 0,
    artwork_request: 0,
    invoice_request: 0,
    payment_query: 0,
    delivery_request: 0,
    complaint: 0,
    team_log: 0,
    production_update: 0,
    design_update: 0,
    general_support: 0,
    unknown: 0,
  };

  const summary = {
    inbound: 0,
    highRisk: 0,
    support: 0,
    design: 0,
    production: 0,
    finance: 0,
    delivery: 0,
    teamLog: 0,
    intentCounts,
  };

  conversations.forEach((conversation) => {
    (conversation.opps_messages || []).forEach((message) => {
      if (message.direction !== "inbound" || !message.created_at || !isToday(new Date(message.created_at))) return;
      summary.inbound += 1;
      const intelligence = message.opps_message_intelligence?.[0];
      const intent = intelligence?.intent || "unknown";
      const riskLevel = intelligence?.risk_level || "normal";

      if (intentCounts[intent] !== undefined) {
        intentCounts[intent] += 1;
      } else {
        intentCounts.unknown += 1;
      }

      if (riskLevel === "high") summary.highRisk += 1;
      if (["quote_request", "complaint", "general_support"].includes(intent)) summary.support += 1;
      if (["artwork_request", "design_update"].includes(intent)) summary.design += 1;
      if (["order_update", "production_update"].includes(intent)) summary.production += 1;
      if (["invoice_request", "payment_query"].includes(intent)) summary.finance += 1;
      if (intent === "delivery_request") summary.delivery += 1;
      if (intent === "team_log") summary.teamLog += 1;
    });
  });

  return summary;
}

function formatOrderLabel(order) {
  return [order.order_number, order.client_name || order.status].filter(Boolean).join(" • ") || order.id;
}

function formatClientLabel(client) {
  return [client.name, client.whatsapp_name || client.phone || client.email].filter(Boolean).join(" • ") || client.id;
}

