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
  const canDelete = comment.userId === currentUserId || currentUserRole === "admin" || currentUserRole === "owner";

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
      <Avatar size="sm" className="shrink-0 mt-0.5">
        <AvatarImage src={comment.userImage ?? undefined} />
        <AvatarFallback>{getInitials(comment.userName ?? "")}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{comment.userName ?? "Unknown"}</span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </span>
          {comment.editedAt && <span className="text-xs text-muted-foreground italic">(edited)</span>}
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
          <p className="text-sm mt-0.5 whitespace-pre-wrap">{comment.content}</p>
        )}

        {!editing && (
          <div className="flex items-center gap-1 mt-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs text-muted-foreground"
              onClick={() => setReplying(!replying)}
            >
              <CornerDownRight className="h-3 w-3 mr-1" />
              Reply
            </Button>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs text-muted-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
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
          <div className="mt-3 space-y-3 pl-4 border-l-2 border-muted">
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
    if (c.parentId) (repliesByParent[c.parentId] ??= []).push(c);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <MessageSquare className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 space-y-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment…"
            className="min-h-[72px] text-sm resize-none"
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
        <p className="text-sm text-muted-foreground text-center py-4">No comments yet.</p>
      ) : (
        <div className="space-y-4 pt-2 border-t">
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
