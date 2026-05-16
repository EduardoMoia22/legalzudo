import { getAccount } from "./account-repository.js";
import { InstagramRemoteComment, InstagramService } from "./instagram.service.js";
import { addEvent } from "./media-repository.js";
import {
  getRemoteComment,
  getRemotePost,
  listCommentsForPost,
  listRemotePosts,
  markCommentDeleted,
  markCommentHidden,
  markCommentReplied,
  RemoteComment,
  RemotePost,
  upsertRemoteComment,
  upsertRemotePost
} from "./remote-repository.js";

export class RemoteService {
  constructor(private readonly instagram: InstagramService) {}

  async syncPosts(accountId: string): Promise<RemotePost[]> {
    const account = await getAccount(accountId);
    if (!account) throw new Error("Conta nao encontrada");
    const posts = await this.instagram.listAccountMedia(account);
    const saved: RemotePost[] = [];
    for (const post of posts) {
      saved.push(await upsertRemotePost(account.id, post));
    }
    await addEvent({
      accountId: account.id,
      eventType: "remote_posts_synced",
      message: `${saved.length} post(s) sincronizado(s)`
    });
    return saved;
  }

  async listPosts(accountId: string): Promise<RemotePost[]> {
    return listRemotePosts(accountId);
  }

  async syncComments(accountId: string, remotePostId: string): Promise<RemoteComment[]> {
    const account = await getAccount(accountId);
    if (!account) throw new Error("Conta nao encontrada");
    const post = await getRemotePost(remotePostId, accountId);
    if (!post) throw new Error("Post nao encontrado para esta conta");

    const comments = await this.instagram.listMediaComments(account, post.instagram_media_id);
    for (const comment of comments) {
      await this.saveCommentTree(account.id, post.id, comment, null);
    }

    await addEvent({
      accountId: account.id,
      eventType: "comments_synced",
      message: `${comments.length} comentario(s) sincronizado(s)`,
      meta: { instagramMediaId: post.instagram_media_id }
    });

    return listCommentsForPost(post.id);
  }

  async listComments(remotePostId: string): Promise<RemoteComment[]> {
    return listCommentsForPost(remotePostId);
  }

  async replyToComment(commentId: string, message: string): Promise<string> {
    const comment = await getRemoteComment(commentId);
    if (!comment) throw new Error("Comentario nao encontrado");
    const account = await getAccount(comment.account_id);
    if (!account) throw new Error("Conta nao encontrada");

    const replyId = await this.instagram.replyToComment(account, comment.instagram_comment_id, message);
    await markCommentReplied(comment.id);
    await addEvent({
      accountId: account.id,
      eventType: "comment_replied",
      message: `Resposta enviada para comentario ${comment.instagram_comment_id}`,
      meta: { replyId }
    });
    return replyId;
  }

  async setCommentHidden(commentId: string, hidden: boolean): Promise<RemoteComment | null> {
    const comment = await getRemoteComment(commentId);
    if (!comment) throw new Error("Comentario nao encontrado");
    const account = await getAccount(comment.account_id);
    if (!account) throw new Error("Conta nao encontrada");

    await this.instagram.setCommentHidden(account, comment.instagram_comment_id, hidden);
    const updated = await markCommentHidden(comment.id, hidden);
    await addEvent({
      accountId: account.id,
      eventType: hidden ? "comment_hidden" : "comment_unhidden",
      message: `${hidden ? "Ocultado" : "Reexibido"} comentario ${comment.instagram_comment_id}`
    });
    return updated;
  }

  async deleteComment(commentId: string): Promise<RemoteComment | null> {
    const comment = await getRemoteComment(commentId);
    if (!comment) throw new Error("Comentario nao encontrado");
    const account = await getAccount(comment.account_id);
    if (!account) throw new Error("Conta nao encontrada");

    await this.instagram.deleteComment(account, comment.instagram_comment_id);
    const updated = await markCommentDeleted(comment.id);
    await addEvent({
      accountId: account.id,
      eventType: "comment_deleted",
      message: `Comentario ${comment.instagram_comment_id} excluido`
    });
    return updated;
  }

  private async saveCommentTree(
    accountId: string,
    remotePostId: string,
    comment: InstagramRemoteComment,
    parentCommentId: string | null
  ): Promise<void> {
    await upsertRemoteComment(accountId, remotePostId, {
      id: comment.id,
      parent_comment_id: parentCommentId,
      text: comment.text,
      username: comment.username,
      hidden: comment.hidden,
      like_count: comment.like_count,
      timestamp: comment.timestamp
    });

    for (const reply of comment.replies?.data ?? []) {
      await this.saveCommentTree(accountId, remotePostId, reply, comment.id);
    }
  }
}
