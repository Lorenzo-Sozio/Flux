"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { CornerDownRight, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { DealComment } from "@/actions/deal-comments";
import { addDealComment, deleteDealComment, editDealComment } from "@/actions/deal-comments";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { can } from "@/lib/permissions";
import { getInitials } from "@/lib/utils";

interface Props {
  dealId: string;
  initialComments: DealComment[];
  currentUserId: string;
  currentUserRole: string;
}

interface CommentRowProps {
  comment: DealComment;
  replies: DealComment[];
  dealId: string;
  currentUserId: string;
  currentUserRole: string;
  onAction: () => void;
}

function CommentRow({ comment, replies, dealId, currentUserId, currentUserRole, onAction }: CommentRowProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [replying, setReplying] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);

  const canEdit = comment.userId === currentUserId;
  // Asked as a capability rather than compared as a string, so this cannot drift
  // from what `deleteDealComment` actually allows. Your own comment is always
  // yours to remove; anybody else's needs the workspace's admin rank.
  const canDelete = comment.userId === currentUserId || can(currentUserRole, "user:read");

  async function run(action: () => Promise<void>, setLoading: (v: boolean) => void, errorMsg: string) {
    setLoading(true);
    try {
      await action();
      onAction();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : errorMsg);
    } finally {
      setLoading(false);
    }
  }

  const handleEdit = () =>
    run(
      async () => {
        await editDealComment(comment.id, editContent, dealId);
        setEditing(false);
      },
      setEditLoading,
      "Error saving edit",
    );

  const handleDelete = () =>
    run(() => deleteDealComment(comment.id, dealId), setDeleteLoading, "Error deleting comment");

  const handleReply = () =>
    run(
      async () => {
        await addDealComment(dealId, replyContent, comment.id);
        setReplyContent("");
        setReplying(false);
      },
      setReplyLoading,
      "Error posting reply",
    );

  return (
    <div className="flex gap-3">
      <Avatar size="sm" className="mt-0.5 shrink-0">
        <AvatarImage src={comment.userImage ?? undefined} />
        <AvatarFallback>{getInitials(comment.userName ?? "")}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-sm">{comment.userName ?? "Unknown"}</span>
          <span className="text-muted-foreground text-xs">
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </span>
          {comment.editedAt && <span className="text-muted-foreground text-xs italic">(edited)</span>}
        </div>

        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[60px] text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleEdit} disabled={editLoading}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setEditContent(comment.content);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap text-sm">{comment.content}</p>
        )}

        {!editing && (
          <div className="mt-1 flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-muted-foreground text-xs"
              onClick={() => setReplying(!replying)}
            >
              <CornerDownRight className="mr-1 h-3 w-3" />
              Reply
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-muted-foreground text-xs"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-muted-foreground text-xs hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteLoading}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {replying && (
          <div className="mt-2 space-y-2">
            <Textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Write a reply…"
              className="min-h-[60px] text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleReply} disabled={replyLoading || !replyContent.trim()}>
                Reply
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReplying(false);
                  setReplyContent("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {replies.length > 0 && (
          <div className="mt-3 space-y-3 border-muted border-l-2 pl-4">
            {replies.map((reply) => (
              <CommentRow
                key={reply.id}
                comment={reply}
                replies={[]}
                dealId={dealId}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onAction={onAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CommentsThread({ dealId, initialComments, currentUserId, currentUserRole }: Props) {
  const router = useRouter();
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!newComment.trim()) return;
    setLoading(true);
    try {
      await addDealComment(dealId, newComment);
      setNewComment("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error posting comment");
    } finally {
      setLoading(false);
    }
  }

  const roots = initialComments.filter((c) => !c.parentId);
  const repliesByParent: Record<string, DealComment[]> = {};
  for (const c of initialComments) {
    if (!c.parentId) continue;
    repliesByParent[c.parentId] ??= [];
    repliesByParent[c.parentId].push(c);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment…"
            className="min-h-[72px] resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit();
            }}
          />
          <Button size="sm" onClick={handleSubmit} disabled={loading || !newComment.trim()}>
            Comment
          </Button>
        </div>
      </div>

      {roots.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground text-sm">No comments yet.</p>
      ) : (
        <div className="space-y-4 border-t pt-2">
          {roots.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              replies={repliesByParent[comment.id] ?? []}
              dealId={dealId}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onAction={router.refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
