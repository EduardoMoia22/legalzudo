const state = {
  accounts: [],
  media: [],
  posts: [],
  comments: [],
  events: [],
  selectedAccountId: null,
  selectedPostId: null,
  selectedCarouselIds: new Set(),
  status: "",
  mediaPage: 1,
  mediaLimit: 18,
  mediaTotal: 0,
  mediaTotalPages: 1,
  mediaCounts: {}
};

const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Falha HTTP ${response.status}`);
  return data;
}

function accountName(account) {
  return account.username ? `@${account.username}` : account.instagramUserId;
}

function selectedAccount() {
  return state.accounts.find((account) => account.id === state.selectedAccountId) || null;
}

function renderMetrics() {
  const counts = state.mediaCounts;
  $("#metrics").innerHTML = [
    ["Contas", state.accounts.length],
    ["Pendentes", counts.pending || 0],
    ["Aprovadas", counts.approved || 0],
    ["Posts IG", state.posts.length]
  ]
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderAccounts() {
  const list = $("#accountList");
  if (state.accounts.length === 0) {
    list.innerHTML = `<div class="account-card"><strong>Nenhuma conta conectada</strong><p class="meta">Use Conectar Instagram para iniciar o OAuth oficial.</p></div>`;
    return;
  }

  list.innerHTML = state.accounts
    .map(
      (account) => `
        <article class="account-card ${account.id === state.selectedAccountId ? "selected" : ""}" data-account="${account.id}">
          <header>
            <strong>${accountName(account)}</strong>
            <span class="status ${account.active ? "approved" : "rejected"}">${account.active ? "ativa" : "pausada"}</span>
          </header>
          <p class="meta">${account.postsPerDay}/dia · ${account.postTimes.join(", ") || "sem horários"}</p>
          <p class="meta">Expira: ${account.expiresAt ? new Date(account.expiresAt).toLocaleString() : "não informado"}</p>
        </article>
      `
    )
    .join("");

  list.querySelectorAll("[data-account]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedAccountId = el.dataset.account;
      fillAccountForm();
      renderAccounts();
      renderMedia();
      loadPosts().catch((error) => toast(error.message));
    });
  });
}

function fillAccountForm() {
  const account = selectedAccount();
  $("#accountId").value = account?.id || "";
  $("#accountLabel").value = account ? accountName(account) : "";
  $("#postsPerDay").value = account?.postsPerDay || 2;
  $("#postTimes").value = account?.postTimes?.join(",") || "10:00,19:00";
  $("#defaultCaption").value = account?.defaultCaption || "";
  $("#active").checked = Boolean(account?.active);
  $("#publishAsReels").checked = account ? account.publishAsReels : true;
  $("#shareToFeed").checked = account ? account.shareToFeed : true;
}

function renderMedia() {
  const list = $("#mediaList");
  const visibleIds = new Set(state.media.map((item) => item.id));
  for (const id of [...state.selectedCarouselIds]) {
    if (!visibleIds.has(id)) state.selectedCarouselIds.delete(id);
  }
  if (state.media.length === 0) {
    list.innerHTML = `<div class="account-card"><strong>Nenhuma mídia encontrada</strong><p class="meta">Envie um vídeo ou coloque arquivos em /videos e sincronize.</p></div>`;
    return;
  }

  list.innerHTML = state.media
    .map((item) => {
      const account = state.accounts.find((entry) => entry.id === item.approvedAccountId);
      const preview =
        item.mediaType === "image"
          ? `<img class="media-preview" src="${item.previewUrl}" alt="${item.originalName}">`
          : `<video class="media-preview" controls preload="none" src="${item.previewUrl}"></video>`;
      return `
        <article class="media-card">
          <label class="carousel-check">
            <input type="checkbox" data-carousel-select="${item.id}" ${state.selectedCarouselIds.has(item.id) ? "checked" : ""} ${item.status !== "approved" ? "disabled" : ""}>
            Carrossel
          </label>
          ${preview}
          <div class="media-info">
            <header>
              <strong title="${item.originalName}">${item.originalName}</strong>
              <span class="status ${item.status}">${item.status}</span>
            </header>
            <p class="meta">${item.mediaType === "image" ? "Imagem JPEG" : "Vídeo"} · ${account ? accountName(account) : "sem conta"} · ${new Date(item.createdAt).toLocaleString()}</p>
            ${item.lastError ? `<p class="meta">Erro: ${item.lastError}</p>` : ""}
            <textarea data-caption="${item.id}" rows="3" placeholder="Legenda">${item.caption || ""}</textarea>
            <div class="media-actions">
              <button class="secondary" data-approve="${item.id}">Aprovar</button>
              <button class="secondary" data-reject="${item.id}">Rejeitar</button>
              <button class="primary wide" data-publish="${item.id}">Postar agora</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  list.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => approve(button.dataset.approve));
  });
  list.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => rejectMedia(button.dataset.reject));
  });
  list.querySelectorAll("[data-publish]").forEach((button) => {
    button.addEventListener("click", () => publishMedia(button.dataset.publish));
  });
  list.querySelectorAll("[data-carousel-select]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedCarouselIds.add(input.dataset.carouselSelect);
      else state.selectedCarouselIds.delete(input.dataset.carouselSelect);
      renderCarouselCount();
    });
  });
  renderCarouselCount();
  renderMediaPagination();
}

function renderMediaPagination() {
  $("#mediaPageInfo").textContent = `Página ${state.mediaPage} de ${state.mediaTotalPages} · ${state.mediaTotal} mídia(s)`;
  $("#prevMediaPage").disabled = state.mediaPage <= 1;
  $("#nextMediaPage").disabled = state.mediaPage >= state.mediaTotalPages;
}

function renderCarouselCount() {
  const countEl = $("#carouselCount");
  if (countEl) countEl.textContent = `${state.selectedCarouselIds.size} selecionada(s)`;
}

function renderEvents() {
  const list = $("#eventList");
  if (state.events.length === 0) {
    list.innerHTML = `<div class="event-row"><strong>Nenhum evento ainda</strong><span class="meta">Publicações e falhas aparecerão aqui.</span></div>`;
    return;
  }
  list.innerHTML = state.events
    .map(
      (event) => `
      <div class="event-row">
        <strong>${event.event_type} ${event.filename ? `· ${event.filename}` : ""}</strong>
        <span class="meta">${event.message || ""}</span>
        <span class="meta">${event.username ? `@${event.username}` : event.instagram_user_id || ""} · ${new Date(event.created_at).toLocaleString()}</span>
      </div>`
    )
    .join("");
}

function renderRemotePosts() {
  const list = $("#remotePostList");
  if (!selectedAccount()) {
    list.innerHTML = `<div class="event-row"><strong>Selecione uma conta</strong><span class="meta">Os posts são separados por conta conectada.</span></div>`;
    return;
  }
  if (state.posts.length === 0) {
    list.innerHTML = `<div class="event-row"><strong>Nenhum post sincronizado</strong><span class="meta">Use Sincronizar posts para buscar mídias publicadas no Instagram.</span></div>`;
    return;
  }
  list.innerHTML = state.posts
    .map((post) => {
      const preview = post.media_url || post.thumbnail_url;
      return `
        <article class="remote-post ${post.id === state.selectedPostId ? "selected" : ""}" data-post="${post.id}">
          ${preview ? `<img src="${preview}" alt="">` : `<div class="post-placeholder">Post</div>`}
          <div>
            <header>
              <strong>${post.media_product_type || post.media_type || "MEDIA"}</strong>
              <span class="meta">${post.timestamp ? new Date(post.timestamp).toLocaleString() : "sem data"}</span>
            </header>
            <p>${post.caption ? escapeHtml(post.caption).slice(0, 140) : "Sem legenda"}</p>
            <p class="meta">${post.like_count ?? 0} curtidas · ${post.comments_count ?? 0} comentários</p>
          </div>
        </article>
      `;
    })
    .join("");
  list.querySelectorAll("[data-post]").forEach((el) => {
    el.addEventListener("click", async () => {
      state.selectedPostId = el.dataset.post;
      renderRemotePosts();
      await loadComments();
    });
  });
}

function renderComments() {
  const list = $("#commentList");
  if (!state.selectedPostId) {
    list.innerHTML = `<div class="event-row"><strong>Selecione um post</strong><span class="meta">Clique em um post sincronizado para ver os comentários.</span></div>`;
    return;
  }
  if (state.comments.length === 0) {
    list.innerHTML = `<div class="event-row"><strong>Nenhum comentário local</strong><span class="meta">Use Sincronizar comentários para buscar na Meta.</span></div>`;
    return;
  }
  list.innerHTML = state.comments
    .map(
      (comment) => `
      <article class="comment-row ${comment.parent_comment_id ? "reply" : ""}">
        <header>
          <strong>${comment.username ? `@${comment.username}` : "Comentário"}</strong>
          <span class="status ${comment.hidden ? "rejected" : "approved"}">${comment.hidden ? "oculto" : "visível"}</span>
        </header>
        <p>${escapeHtml(comment.text || "")}</p>
        <p class="meta">${comment.timestamp ? new Date(comment.timestamp).toLocaleString() : ""} ${comment.replied_locally ? "· respondido" : ""}</p>
        <textarea data-reply="${comment.id}" rows="2" placeholder="Responder publicamente"></textarea>
        <div class="comment-actions">
          <button class="secondary" data-send-reply="${comment.id}">Responder</button>
          <button class="secondary" data-hide="${comment.id}" data-hidden="${comment.hidden ? "false" : "true"}">${comment.hidden ? "Reexibir" : "Ocultar"}</button>
          <button class="secondary danger" data-delete-comment="${comment.id}">Excluir</button>
        </div>
      </article>`
    )
    .join("");
  list.querySelectorAll("[data-send-reply]").forEach((button) => {
    button.addEventListener("click", () => replyToComment(button.dataset.sendReply));
  });
  list.querySelectorAll("[data-hide]").forEach((button) => {
    button.addEventListener("click", () => setCommentHidden(button.dataset.hide, button.dataset.hidden === "true"));
  });
  list.querySelectorAll("[data-delete-comment]").forEach((button) => {
    button.addEventListener("click", () => deleteComment(button.dataset.deleteComment));
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadAll() {
  const [accounts, media, events] = await Promise.all([
    api("/api/accounts"),
    api(`/api/media?page=${state.mediaPage}&limit=${state.mediaLimit}${state.status ? `&status=${state.status}` : ""}`),
    api("/api/events")
  ]);
  state.accounts = accounts.accounts;
  state.media = media.media;
  state.mediaTotal = media.total;
  state.mediaTotalPages = media.totalPages;
  state.mediaCounts = media.counts || {};
  state.events = events.events;
  if (!state.selectedAccountId && state.accounts[0]) state.selectedAccountId = state.accounts[0].id;
  renderMetrics();
  renderAccounts();
  fillAccountForm();
  renderMedia();
  renderEvents();
  await loadPosts();
}

async function loadPosts() {
  const account = selectedAccount();
  if (!account) {
    state.posts = [];
    state.comments = [];
    renderMetrics();
    renderRemotePosts();
    renderComments();
    return;
  }
  const data = await api(`/api/accounts/${account.id}/posts`);
  state.posts = data.posts;
  if (state.selectedPostId && !state.posts.some((post) => post.id === state.selectedPostId)) {
    state.selectedPostId = null;
    state.comments = [];
  }
  renderMetrics();
  renderRemotePosts();
  renderComments();
}

async function loadComments() {
  if (!state.selectedPostId) {
    state.comments = [];
    renderComments();
    return;
  }
  const data = await api(`/api/posts/${state.selectedPostId}/comments`);
  state.comments = data.comments;
  renderComments();
}

async function approve(id) {
  const account = selectedAccount();
  if (!account) {
    toast("Selecione uma conta antes de aprovar.");
    return;
  }
  const caption = document.querySelector(`[data-caption="${id}"]`).value;
  await api(`/api/media/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, caption })
  });
  toast("Mídia aprovada.");
  await loadAll();
}

async function approveAll() {
  const account = selectedAccount();
  if (!account) return toast("Selecione uma conta antes de aprovar tudo.");
  const result = await api("/api/media/approve-all", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id })
  });
  toast(`${result.media.length} mídia(s) aprovada(s).`);
  await loadAll();
}

async function applyCaptionAll() {
  const caption = $("#bulkCaption").value;
  if (!caption.trim()) return toast("Digite a legenda que será aplicada.");
  const result = await api("/api/media/captions/apply-all", {
    method: "POST",
    body: JSON.stringify({ caption })
  });
  toast(`Legenda aplicada em ${result.media.length} mídia(s).`);
  await loadAll();
}

async function applyApprovedCaption() {
  const caption = $("#approvedCaption").value;
  if (!caption.trim()) return toast("Digite a legenda para os aprovados.");
  const result = await api("/api/media/captions/approved", {
    method: "POST",
    body: JSON.stringify({ caption })
  });
  toast(`Legenda alterada em ${result.media.length} mídia(s) aprovada(s).`);
  await loadAll();
}

async function rejectMedia(id) {
  await api(`/api/media/${id}/reject`, { method: "POST", body: JSON.stringify({}) });
  toast("Mídia rejeitada.");
  await loadAll();
}

async function publishMedia(id) {
  const account = selectedAccount();
  if (!account) {
    toast("Selecione uma conta para publicar.");
    return;
  }
  const caption = document.querySelector(`[data-caption="${id}"]`).value;
  await api(`/api/media/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, caption })
  });
  toast("Publicação iniciada. Aguarde o processamento da Meta.");
  await api(`/api/media/${id}/publish`, {
    method: "POST",
    body: JSON.stringify({ accountId: account.id })
  });
  toast("Publicado com sucesso.");
  await loadAll();
}

async function publishCarousel() {
  const account = selectedAccount();
  if (!account) return toast("Selecione uma conta para publicar carrossel.");
  const mediaIds = [...state.selectedCarouselIds];
  if (mediaIds.length < 2 || mediaIds.length > 10) {
    return toast("Selecione de 2 a 10 mídias aprovadas.");
  }
  const invalid = state.media.filter((item) => mediaIds.includes(item.id) && item.approvedAccountId !== account.id);
  if (invalid.length > 0) return toast("Todas as mídias precisam estar aprovadas para a conta selecionada.");

  toast("Publicação de carrossel iniciada. Aguarde a Meta processar os itens.");
  await api("/api/media/carousel/publish", {
    method: "POST",
    body: JSON.stringify({
      accountId: account.id,
      mediaIds,
      caption: $("#carouselCaption").value
    })
  });
  state.selectedCarouselIds.clear();
  $("#carouselCaption").value = "";
  toast("Carrossel publicado com sucesso.");
  await loadAll();
}

$("#accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#accountId").value;
  if (!id) return toast("Selecione uma conta.");
  await api(`/api/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      active: $("#active").checked,
      postsPerDay: Number($("#postsPerDay").value),
      postTimes: $("#postTimes").value.split(",").map((time) => time.trim()).filter(Boolean),
      publishAsReels: $("#publishAsReels").checked,
      shareToFeed: $("#shareToFeed").checked,
      defaultCaption: $("#defaultCaption").value
    })
  });
  toast("Configuração salva.");
  await loadAll();
});

$("#publishNextBtn").addEventListener("click", async () => {
  const account = selectedAccount();
  if (!account) return toast("Selecione uma conta.");
  toast("Publicando próximo vídeo aprovado.");
  await api(`/api/accounts/${account.id}/publish-next`, { method: "POST", body: JSON.stringify({}) });
  await loadAll();
});

$("#refreshTokenBtn").addEventListener("click", async () => {
  const account = selectedAccount();
  if (!account) return toast("Selecione uma conta.");
  await api("/auth/refresh-token", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id })
  });
  toast("Token renovado.");
  await loadAll();
});

$("#syncBtn").addEventListener("click", async () => {
  const result = await api("/api/media/sync", { method: "POST", body: JSON.stringify({}) });
  toast(`${result.inserted} mídia(s) importada(s).`);
  await loadAll();
});

$("#approveAllBtn").addEventListener("click", () => {
  approveAll().catch((error) => toast(error.message));
});

$("#applyCaptionAllBtn").addEventListener("click", () => {
  applyCaptionAll().catch((error) => toast(error.message));
});

$("#applyApprovedCaptionBtn").addEventListener("click", () => {
  applyApprovedCaption().catch((error) => toast(error.message));
});

$("#publishCarouselBtn").addEventListener("click", () => {
  publishCarousel().catch((error) => toast(error.message));
});

$("#syncPostsBtn").addEventListener("click", async () => {
  const account = selectedAccount();
  if (!account) return toast("Selecione uma conta.");
  const data = await api(`/api/accounts/${account.id}/posts/sync`, { method: "POST", body: JSON.stringify({}) });
  toast(`${data.posts.length} post(s) sincronizado(s).`);
  await loadPosts();
});

$("#syncCommentsBtn").addEventListener("click", async () => {
  const account = selectedAccount();
  if (!account || !state.selectedPostId) return toast("Selecione uma conta e um post.");
  const data = await api(`/api/posts/${state.selectedPostId}/comments/sync`, {
    method: "POST",
    body: JSON.stringify({ accountId: account.id })
  });
  state.comments = data.comments;
  toast(`${data.comments.length} comentário(s) sincronizado(s).`);
  renderComments();
});

async function replyToComment(id) {
  const message = document.querySelector(`[data-reply="${id}"]`).value.trim();
  if (!message) return toast("Digite uma resposta.");
  await api(`/api/comments/${id}/reply`, { method: "POST", body: JSON.stringify({ message }) });
  toast("Resposta enviada.");
  await loadComments();
}

async function setCommentHidden(id, hidden) {
  await api(`/api/comments/${id}/hide`, { method: "POST", body: JSON.stringify({ hidden }) });
  toast(hidden ? "Comentário ocultado." : "Comentário reexibido.");
  await loadComments();
}

async function deleteComment(id) {
  if (!window.confirm("Excluir este comentário pela API oficial?")) return;
  await api(`/api/comments/${id}`, { method: "DELETE" });
  toast("Comentário excluído.");
  await loadComments();
}

$("#uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const result = await api("/api/media/upload", { method: "POST", body: form });
  event.currentTarget.reset();
  const skipped = result.duplicates?.length ? ` · ${result.duplicates.length} duplicada(s)` : "";
  toast(`${result.inserted} mídia(s) enviada(s)${skipped}.`);
  await loadAll();
});

$("#statusTabs").querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", async () => {
    $("#statusTabs").querySelectorAll("button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.status = button.dataset.status;
    state.mediaPage = 1;
    await loadAll();
  });
});

$("#prevMediaPage").addEventListener("click", async () => {
  if (state.mediaPage <= 1) return;
  state.mediaPage -= 1;
  await loadAll();
});

$("#nextMediaPage").addEventListener("click", async () => {
  if (state.mediaPage >= state.mediaTotalPages) return;
  state.mediaPage += 1;
  await loadAll();
});

loadAll().catch((error) => toast(error.message));
