import { useMemo, useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Send, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { dataClient } from "@/api/dataClient";
import { toast } from "sonner";
import { isAssignableTeamUser } from "@/lib/teamUsers";

const REACTIONS = ["👍", "❤️", "✅", "🔥", "🙌"];

const VISIBILITY = [
  { value: "internal", label: "Internal" },
  { value: "admin", label: "Admin only" },
  { value: "tagged", label: "Tagged users" },
  { value: "investor", label: "Investor visible" },
];

function getDisplayName(user) {
  return user?.full_name || user?.name || user?.email || "Unknown user";
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function extractMentions(text, users) {
  const lowerText = text.toLowerCase();
  return users
    .filter((user) => {
      const name = getDisplayName(user).toLowerCase();
      const firstName = name.split(/\s+/)[0];
      const email = String(user.email || user.user_email || "").toLowerCase();
      return lowerText.includes(`@${name}`) || lowerText.includes(`@${firstName}`) || (email && lowerText.includes(`@${email}`));
    })
    .map((user) => ({
      email: user.email || user.user_email,
      name: getDisplayName(user),
      role: user.role || "user",
    }));
}

export default function CommentThread({
  comments = [],
  users = [],
  onChange,
  title = "Comments",
  placeholder = "Comment or tag @name...",
  compact = false,
}) {
  const [text, setText] = useState("");
  const [taggedEmail, setTaggedEmail] = useState("_none");
  const [visibility, setVisibility] = useState("internal");
  const [myEmail, setMyEmail] = useState("");
  const activeUsers = useMemo(() => users.filter(isAssignableTeamUser), [users]);

  useEffect(() => {
    dataClient.auth.me().then(u => { if (u?.email) setMyEmail(u.email); }).catch(() => {});
  }, []);

  const toggleReaction = (commentId, emoji) => {
    const updated = comments.map(c => {
      if ((c.id || c.created_at) !== commentId) return c;
      const reactions = { ...(c.reactions || {}) };
      const list = reactions[emoji] ? [...reactions[emoji]] : [];
      const idx = list.indexOf(myEmail);
      if (idx === -1) list.push(myEmail);
      else list.splice(idx, 1);
      if (list.length === 0) delete reactions[emoji];
      else reactions[emoji] = list;
      return { ...c, reactions };
    });
    onChange(updated);
  };

  const addComment = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const me = await dataClient.auth.me().catch(() => null);
    const selectedUser = activeUsers.find((user) => (user.email || user.user_email) === taggedEmail);
    const mentions = [
      ...extractMentions(trimmed, activeUsers),
      ...(selectedUser ? [{ email: selectedUser.email || selectedUser.user_email, name: getDisplayName(selectedUser), role: selectedUser.role || "user" }] : []),
    ].filter((mention, index, list) => mention.email && list.findIndex((item) => item.email === mention.email) === index);

    const nextComment = {
      id: `comment-${Date.now()}`,
      author_email: me?.email || "unknown",
      author_name: getDisplayName(me),
      author_role: me?.role || "user",
      text: trimmed,
      visibility,
      mentions,
      created_at: new Date().toISOString(),
    };

    onChange([...(comments || []), nextComment]);
    setText("");
    setTaggedEmail("_none");
    toast.success(mentions.length ? `Comment added and tagged ${mentions.length}` : "Comment added");
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title} ({comments.length})
        </h3>
        <Badge variant="outline" className="gap-1 rounded-full text-[10px]">
          <Shield className="h-3 w-3" />
          visibility
        </Badge>
      </div>

      <div className="space-y-2">
        {comments.length === 0 ? (
          <p className="rounded-xl bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">No comments yet</p>
        ) : comments.map((comment) => {
          const author = comment.author_name || comment.author || comment.author_email || "Unknown";
          const created = comment.created_at || comment.timestamp;
          const commentId = comment.id || created;
          return (
            <div key={commentId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {getInitials(author)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-semibold text-foreground">{author}</p>
                    {comment.author_role && <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[10px]">{comment.author_role}</Badge>}
                    {comment.visibility && <span className="text-[10px] text-muted-foreground">{comment.visibility}</span>}
                    {created && <span className="text-[10px] text-muted-foreground">{formatDistanceToNow(new Date(created), { addSuffix: true })}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{comment.text}</p>
                  {(comment.mentions || []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {comment.mentions.map((mention) => (
                        <Badge key={mention.email || mention.name} className="rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                          @{mention.name || mention.email}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {/* Emoji reactions */}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {REACTIONS.map(emoji => {
                      const list = comment.reactions?.[emoji] || [];
                      const active = myEmail && list.includes(myEmail);
                      return (
                        <button
                          key={emoji}
                          onClick={() => toggleReaction(commentId, emoji)}
                          className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-all ${
                            active
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-secondary/50 border-transparent text-muted-foreground hover:bg-secondary"
                          }`}
                          title={list.length ? list.join(", ") : "React"}
                        >
                          {emoji}{list.length > 0 && <span className="font-medium ml-0.5">{list.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-secondary/20 p-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) addComment();
          }}
          className="rounded-lg bg-card"
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_150px_auto]">
          <Select value={taggedEmail} onValueChange={setTaggedEmail}>
            <SelectTrigger className="h-9 rounded-lg bg-card">
              <SelectValue placeholder="Tag someone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">No tag</SelectItem>
              {activeUsers.map((user) => (
                <SelectItem key={user.id || user.email} value={user.email || user.user_email}>
                  {getDisplayName(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className="h-9 rounded-lg bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITY.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button type="button" onClick={addComment} className="h-9 rounded-lg">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
