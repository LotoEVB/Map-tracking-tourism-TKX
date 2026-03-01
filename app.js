const SUPABASE_URL = "https://djbwtrfxzcvyenahhxpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WYXUvbUsz_qUdb9tnMN6PQ_lb6lQH9E";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const SEASONS = Array.from({ length: 12 }, (_unused, index) => `Сезон ${2015 + index}`);

const state = {
  session: null,
  user: null,
  currentRole: "visitors",
  userListId: null,
  locations: [],
  usersSummary: [],
  markersById: new Map(),
  selectedId: null,
  galleryAutoplayTimerId: null,
  mapSearchMarker: null,
  isMapSearchInProgress: false,
  lastMapSearchQuery: "",
  lastMapSearchAt: 0,
  isCreatingLocation: false,
  expandedDescriptionIds: new Set(),
};

const elements = {
  logoutBtn: document.getElementById("logout-btn"),
  adminBtn: document.getElementById("admin-btn"),
  mobileMenuBtn: document.getElementById("mobile-menu-btn"),
  heroMenu: document.getElementById("hero-menu"),
  userPanel: document.getElementById("user-panel"),
  userEmail: document.getElementById("user-email"),
  menuLinks: Array.from(document.querySelectorAll(".menu-link")),
  locationsList: document.getElementById("locations-list"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalActions: document.getElementById("modal-actions"),
  modalClose: document.getElementById("modal-close"),
  modalContent: document.querySelector(".modal-content"),
};

let mobileLocationCardObserver = null;

const BULGARIA_CENTER = [42.7339, 25.4858];
const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
const MOBILE_MEDIA_QUERY = "(max-width: 768px)";
const initialMapZoom = window.matchMedia(DESKTOP_MEDIA_QUERY).matches ? 8 : 6.5;
const map = L.map("map", {
  zoomSnap: 0.5,
  zoomDelta: 0.5,
}).setView(BULGARIA_CENTER, initialMapZoom);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

if (window.matchMedia(DESKTOP_MEDIA_QUERY).matches) {
  requestAnimationFrame(() => {
    map.invalidateSize();
    map.setView(BULGARIA_CENTER, initialMapZoom, { animate: false });
  });
}

initializeMapSearch();
map.on("click", handleMapClick);

wireEvents();
initAuth();

function wireEvents() {
  elements.logoutBtn.addEventListener("click", logout);
  elements.mobileMenuBtn?.addEventListener("click", toggleMobileMenu);

  elements.menuLinks.forEach((button) => {
    button.addEventListener("click", () => {
      handleMenuClick(button.dataset.menu);
      closeMobileMenu();
    });
  });

  document.addEventListener("click", (event) => {
    if (window.innerWidth > 768 || !elements.heroMenu?.classList.contains("mobile-open")) {
      return;
    }

    const target = event.target;
    if (target instanceof Element && !target.closest(".hero-menu") && !target.closest("#mobile-menu-btn")) {
      closeMobileMenu();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeMobileMenu();
    }
  });

  elements.modalClose.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) {
      closeModal();
    }
  });

  elements.locationsList.addEventListener("click", (event) => {
    const card = event.target.closest(".location-card");
    if (!card) {
      return;
    }

    const locationId = card.dataset.id;
    const location = state.locations.find((item) => item.id === locationId);
    if (!location) {
      return;
    }

    const actionBtn = event.target.closest("button[data-action]");
    if (actionBtn) {
      event.stopPropagation();
      const action = actionBtn.dataset.action;
      if (action === "view") {
        openViewPopup(location);
      }
      if (action === "gallery") {
        openGalleryPopup(location);
      }
      if (action === "edit") {
        openEditPopup(location);
      }
      if (action === "delete") {
        openDeletePopup(location);
      }
      if (action === "description-toggle") {
        toggleLocationDescription(location.id);
      }
      return;
    }

    focusLocationOnMap(location.id, true);
  });
}

async function geocodePlace(query) {
  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=bg&q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(nominatimUrl);
    if (response.ok) {
      const results = await response.json();
      const firstResult = Array.isArray(results) ? results[0] : null;
      const latitude = Number(firstResult?.lat);
      const longitude = Number(firstResult?.lon);

      if (firstResult && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return {
          latitude,
          longitude,
          label: firstResult.display_name || query,
        };
      }

      return null;
    }

    if (response.status !== 403 && response.status !== 429) {
      throw new Error("Търсенето е временно недостъпно.");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Търсенето е временно недостъпно.") {
      throw error;
    }
  }

  const openMeteoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=bg&format=json`;
  const fallbackResponse = await fetch(openMeteoUrl);
  if (!fallbackResponse.ok) {
    throw new Error("Търсенето е временно недостъпно.");
  }

  const fallbackData = await fallbackResponse.json();
  const fallbackResult = Array.isArray(fallbackData?.results) ? fallbackData.results[0] : null;
  const latitude = Number(fallbackResult?.latitude);
  const longitude = Number(fallbackResult?.longitude);

  if (!fallbackResult || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const locationParts = [fallbackResult.name, fallbackResult.admin1, fallbackResult.country].filter(Boolean);
  return {
    latitude,
    longitude,
    label: locationParts.length ? locationParts.join(", ") : query,
  };
}

function initializeMapSearch() {
  const SearchControl = L.Control.extend({
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar map-search-control");
      container.innerHTML = `
        <form id="map-search-form" class="map-search-row" novalidate>
          <input id="map-search-input" class="map-search-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="none" placeholder="Търси място..." />
          <button id="map-search-btn" class="map-search-btn" type="button">Търси</button>
        </form>
        <p id="map-search-status" class="map-search-status"></p>
      `;

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const form = container.querySelector("#map-search-form");
      const input = container.querySelector("#map-search-input");
      const button = container.querySelector("#map-search-btn");
      const status = container.querySelector("#map-search-status");

      const runSearch = async () => {
        const query = input?.value?.trim();
        if (!query || !status) {
          return;
        }

        const now = Date.now();
        const isRepeatedQuery = state.lastMapSearchQuery === query && now - state.lastMapSearchAt < 900;
        if (state.isMapSearchInProgress || isRepeatedQuery) {
          return;
        }

        state.isMapSearchInProgress = true;
        state.lastMapSearchQuery = query;
        state.lastMapSearchAt = now;
        if (button instanceof HTMLButtonElement) {
          button.disabled = true;
        }

        status.textContent = "Търсене...";

        try {
          const geocodedPlace = await geocodePlace(query);
          if (!geocodedPlace) {
            status.textContent = "Няма намерен резултат.";
            return;
          }

          const latitude = geocodedPlace.latitude;
          const longitude = geocodedPlace.longitude;
          const placeLabel = geocodedPlace.label;

          map.flyTo([latitude, longitude], 13, { duration: 0.8 });

          if (state.mapSearchMarker) {
            map.removeLayer(state.mapSearchMarker);
          }

          state.mapSearchMarker = L.marker([latitude, longitude]).addTo(map);
          state.mapSearchMarker.bindPopup(`<strong>${escapeHtml(placeLabel)}</strong>`).openPopup();

          const matchedLocation = findMatchedLocationByQuery(query);
          const elevationFromLabel = extractElevationFromTexts(
            placeLabel,
            matchedLocation?.title,
            matchedLocation?.description
          );
          const hasStoredElevation = Number.isFinite(matchedLocation?.elevation_m);
          const elevationM = Number.isFinite(elevationFromLabel)
            ? elevationFromLabel
            : hasStoredElevation
              ? matchedLocation.elevation_m
              : await fetchElevationMeters(latitude, longitude);
          const elevationText = Number.isFinite(elevationM) ? `${elevationM} м` : "без данни";
          const isMobileSearchView = window.matchMedia("(max-width: 768px)").matches;
          status.textContent = isMobileSearchView
            ? `Намерено: ${placeLabel}`
            : `Координати: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} | Височина: ${elevationText}`;

          await persistSearchedElevation(query, elevationM);
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "Грешка при търсене.";
        } finally {
          state.isMapSearchInProgress = false;
          if (button instanceof HTMLButtonElement) {
            button.disabled = false;
          }
        }
      };

      button?.addEventListener("click", runSearch);
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        runSearch();
      });
      input?.addEventListener("search", runSearch);

      return container;
    },
  });

  map.addControl(new SearchControl({ position: "topright" }));
}

function toggleMobileMenu() {
  if (!elements.heroMenu || !elements.mobileMenuBtn) {
    return;
  }

  const isOpen = elements.heroMenu.classList.toggle("mobile-open");
  elements.mobileMenuBtn.setAttribute("aria-expanded", String(isOpen));
  elements.mobileMenuBtn.setAttribute("aria-label", isOpen ? "Затвори меню" : "Отвори меню");
}

function closeMobileMenu() {
  if (!elements.heroMenu || !elements.mobileMenuBtn) {
    return;
  }

  elements.heroMenu.classList.remove("mobile-open");
  elements.mobileMenuBtn.setAttribute("aria-expanded", "false");
  elements.mobileMenuBtn.setAttribute("aria-label", "Отвори меню");
}

async function initAuth() {
  const { data } = await supabaseClient.auth.getSession();
  await applySession(data.session);

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

async function applySession(session) {
  state.session = session;
  state.user = session?.user || null;

  if (!state.user) {
    state.userListId = null;
    state.currentRole = "visitors";
    elements.userPanel.classList.add("hidden");
    elements.adminBtn?.classList.add("hidden");
    elements.userEmail.textContent = "";
    elements.userEmail.dataset.initials = "";
    state.locations = [];
    state.usersSummary = [];
    renderLocationsAndPins();
    return;
  }

  elements.userPanel.classList.remove("hidden");
  const userEmail = state.user.email || "Влязъл потребител";
  elements.userEmail.textContent = userEmail;
  elements.userEmail.dataset.initials = buildUserInitials(userEmail);

  await loadCurrentUserRole();
  if (state.currentRole === "admin") {
    elements.adminBtn?.classList.remove("hidden");
  } else {
    elements.adminBtn?.classList.add("hidden");
  }

  if (state.currentRole !== "visitors") {
    await ensureUserList();
  } else {
    state.userListId = null;
  }
  await loadLocations();
}

function buildUserInitials(value) {
  const source = String(value || "").trim();
  if (!source) {
    return "??";
  }

  const localPart = source.includes("@") ? source.split("@")[0] : source;
  const words = localPart
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  const lettersOnly = localPart.replace(/[^\p{L}\p{N}]/gu, "");
  return lettersOnly.slice(0, 2).toUpperCase() || "??";
}

async function loadCurrentUserRole() {
  if (!state.user) {
    state.currentRole = "visitors";
    return;
  }

  const { data, error } = await supabaseClient
    .from("user_roles")
    .select("user_role")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (error) {
    state.currentRole = "visitors";
    return;
  }

  state.currentRole = data?.user_role || "visitors";
}

async function login(email, password) {
  if (!email || !password) {
    alert("Моля, въведете имейл и парола.");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    alert(`Грешка при вход: ${error.message}`);
    return;
  }

  closeModal();
}

async function register(email, password) {
  if (!email || !password) {
    alert("Моля, въведете имейл и парола.");
    return;
  }

  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) {
    alert(`Грешка при регистрация: ${error.message}`);
    return;
  }

  closeModal();
  alert("Регистрацията е успешна. Необходимо е администратор да ви одобри, преди да публикувате локации.");
}

async function logout() {
  await supabaseClient.auth.signOut();
}

async function ensureUserList() {
  const { data: existingList, error: fetchError } = await supabaseClient
    .from("location_lists")
    .select("id")
    .eq("owner_user_id", state.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    alert(`Грешка при зареждане на списък: ${fetchError.message}`);
    return;
  }

  if (existingList) {
    state.userListId = existingList.id;
    return;
  }

  const { data: newList, error: createError } = await supabaseClient
    .from("location_lists")
    .insert({
      owner_user_id: state.user.id,
      title: "Любими локации",
      description: "Автоматично създаден списък",
    })
    .select("id")
    .single();

  if (createError) {
    alert(`Грешка при създаване на списък: ${createError.message}`);
    return;
  }

  state.userListId = newList.id;
}

async function loadLocations() {
  const { data, error } = await supabaseClient
    .from("locations")
    .select("id, list_id, owner_user_id, title, mountain, description, season, visit_date, latitude, longitude, elevation_m, image_paths, popup_image_path, title_image_path, created_at")
    .order("visit_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    alert(`Грешка при зареждане на локации: ${error.message}`);
    return;
  }

  state.locations = data || [];
  renderLocationsAndPins();
}

function renderLocationsAndPins() {
  renderCards();
  renderMarkers();
}

function buildUsersSummary() {
  const byOwner = new Map();
  state.locations.forEach((location) => {
    const current = byOwner.get(location.owner_user_id) || 0;
    byOwner.set(location.owner_user_id, current + 1);
  });

  state.usersSummary = Array.from(byOwner.entries()).map(([ownerId, count]) => ({
    ownerId,
    count,
  }));
}

function handleMenuClick(menuName) {
  if (menuName === "login") {
    openLoginPopup();
    return;
  }

  if (menuName === "register") {
    openRegisterPopup();
    return;
  }

  if (menuName === "locations") {
    openLocationsMenuPopup();
    return;
  }

  if (menuName === "seasons") {
    openSeasonsMenuPopup();
    return;
  }

  if (menuName === "users") {
    openUsersMenuPopup();
    return;
  }

  if (menuName === "admin") {
    window.location.href = "admin/admin.html";
  }
}

function openSeasonsMenuPopup() {
  if (!state.locations.length) {
    openModal("Сезони", "<p>Няма добавени локации.</p>", [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
    return;
  }

  const seasonMap = new Map();
  state.locations.forEach((location) => {
    const season = location.season || "Без сезон";
    const current = seasonMap.get(season) || [];
    current.push(location);
    seasonMap.set(season, current);
  });

  const ordered = Array.from(seasonMap.entries()).sort((a, b) => a[0].localeCompare(b[0], "bg"));

  const content = `
    <div class="menu-popup-list">
      ${ordered
        .map(
          ([season, seasonLocations]) => `
        <article class="menu-popup-item">
          <p><strong>${escapeHtml(season)}</strong></p>
          <p class="location-meta">Брой локации: ${seasonLocations.length}</p>
          ${seasonLocations
            .map(
              (location) => `
            <div class="location-meta">
              <strong>📍 ${escapeHtml(location.title)}</strong><br>
              ${Number.isFinite(location.elevation_m) ? `⛰️ ${location.elevation_m} м<br>` : ""}
              🏔️ ${escapeHtml(location.mountain || "Непосочена планина")}<br>
              🍂 ${escapeHtml(location.season || "Без сезон")}<br>
              📅 ${escapeHtml(formatBgDate(location.visit_date))}
            </div>
          `
            )
            .join("")}
        </article>
      `
        )
        .join("")}
    </div>
  `;

  openModal("Сезони", content, [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
}

function openLoginPopup() {
  const content = `
    <form id="menu-login-form" class="menu-auth-form">
      <label>Имейл
        <input id="menu-login-email" type="email" autocomplete="email" required />
      </label>
      <label>Парола
        <input id="menu-login-password" type="password" autocomplete="current-password" required />
      </label>
      <button type="submit" hidden aria-hidden="true"></button>
    </form>
  `;

  const submitLogin = async () => {
    const email = document.getElementById("menu-login-email")?.value.trim();
    const password = document.getElementById("menu-login-password")?.value || "";
    await login(email, password);
  };

  openModal("Вход", content, [
    { text: "Отказ", className: "btn btn-secondary", onClick: closeModal },
    {
      text: "Вход",
      className: "btn",
      onClick: submitLogin,
    },
  ]);

  const loginForm = document.getElementById("menu-login-form");
  loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitLogin();
  });
}

function openRegisterPopup() {
  const content = `
    <form id="menu-register-form" class="menu-auth-form">
      <label>Имейл
        <input id="menu-register-email" type="email" autocomplete="email" required />
      </label>
      <label>Парола
        <input id="menu-register-password" type="password" autocomplete="new-password" required />
      </label>
    </form>
  `;

  openModal("Регистрация", content, [
    { text: "Отказ", className: "btn btn-secondary", onClick: closeModal },
    {
      text: "Регистрация",
      className: "btn",
      onClick: async () => {
        const email = document.getElementById("menu-register-email")?.value.trim();
        const password = document.getElementById("menu-register-password")?.value || "";
        await register(email, password);
      },
    },
  ]);
}

function openLocationsMenuPopup() {
  if (!state.locations.length) {
    openModal("Локации", "<p>Няма добавени локации.</p>", [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
    return;
  }

  const content = `
    <div class="menu-popup-list">
      ${state.locations
        .map(
          (location) => `
        <article class="menu-popup-item">
          <p><strong>${escapeHtml(location.title)}</strong></p>
          <p class="location-meta">${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}</p>
          <div class="location-actions">
            <button class="icon-btn" data-menu-location-focus="${location.id}" title="Покажи на карта">
              <i class="fa-solid fa-location-dot"></i>
            </button>
            <button class="icon-btn" data-menu-location-view="${location.id}" title="Преглед">
              <i class="fa-regular fa-eye"></i>
            </button>
          </div>
        </article>
      `
        )
        .join("")}
    </div>
  `;

  openModal("Локации", content, [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);

  elements.modalBody.querySelectorAll("[data-menu-location-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      const locationId = button.getAttribute("data-menu-location-focus");
      closeModal();
      focusLocationOnMap(locationId, true);
    });
  });

  elements.modalBody.querySelectorAll("[data-menu-location-view]").forEach((button) => {
    button.addEventListener("click", () => {
      const locationId = button.getAttribute("data-menu-location-view");
      const location = state.locations.find((item) => item.id === locationId);
      if (location) {
        openViewPopup(location);
      }
    });
  });
}

function openUsersMenuPopup() {
  buildUsersSummary();

  if (!state.usersSummary.length) {
    const message = state.user ? "Все още няма потребители с добавени локации." : "Влезте в профила си, за да видите потребители.";
    openModal("Потребители", `<p>${message}</p>`, [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
    return;
  }

  const content = `
    <div class="menu-popup-list">
      ${state.usersSummary
        .map(({ ownerId, count }) => {
          const shortOwner = ownerId.slice(0, 8);
          const isCurrentUser = ownerId === state.user?.id;
          return `
            <article class="menu-popup-item">
              <p><strong>${isCurrentUser ? "Вие" : `Потребител ${shortOwner}`}</strong></p>
              <p class="location-meta">Брой локации: ${count}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  openModal("Потребители", content, [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
}

function renderCards() {
  if (!state.locations.length) {
    if (mobileLocationCardObserver) {
      mobileLocationCardObserver.disconnect();
    }
    elements.locationsList.innerHTML = "<p>Няма добавени локации.</p>";
    return;
  }

  elements.locationsList.innerHTML = state.locations
    .map((location) => {
      const own = location.owner_user_id === state.user?.id;
      const imageUrl = titleImageUrl(location) || firstImageUrl(location);
      const isMobileView = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
      const descriptionMeta = splitDescriptionForMobile(location.description || "Без описание");
      const isExpanded = state.expandedDescriptionIds.has(location.id);
      const descriptionText = isMobileView && !isExpanded ? descriptionMeta.preview : descriptionMeta.full;
      const hasExpandableDescription = isMobileView && descriptionMeta.hasMore;

      return `
      <article class="location-card ${state.selectedId === location.id ? "active" : ""}" data-id="${location.id}">
        <div class="location-head">
          <h3 class="location-title">${escapeHtml(location.title)}</h3>
          <div class="location-actions">
            <button class="icon-btn" data-action="view" title="Преглед">
              <i class="fa-regular fa-eye"></i>
            </button>
            ${
              location.image_paths?.length
                ? `
              <button class="icon-btn" data-action="gallery" title="Разглеждане на снимки">
                <i class="fa-regular fa-images"></i>
              </button>
            `
                : ""
            }
            ${
              own
                ? `
              <button class="icon-btn" data-action="edit" title="Редакция">
                <i class="fa-regular fa-pen-to-square"></i>
              </button>
              <button class="icon-btn" data-action="delete" title="Изтриване">
                <i class="fa-regular fa-trash-can"></i>
              </button>
            `
                : ""
            }
          </div>
        </div>
        ${Number.isFinite(location.elevation_m) ? `<p class="location-meta"><strong>⛰️ Височина:</strong> ${location.elevation_m} м</p>` : ""}
        <p class="location-meta"><strong>🏔️ Планина:</strong> ${escapeHtml(location.mountain || "Непосочена планина")}</p>
        <p class="location-description">${escapeHtml(descriptionText)}</p>
        ${
          hasExpandableDescription
            ? `<button class="location-description-toggle" type="button" data-action="description-toggle">${isExpanded ? "Скрий" : "....."}</button>`
            : ""
        }
        <p class="location-meta"><strong>🍂 Сезон:</strong> ${escapeHtml(location.season || "Сезон 2015")}</p>
        ${location.visit_date ? `<p class="location-meta"><strong>📅 Дата:</strong> ${escapeHtml(formatBgDate(location.visit_date))}</p>` : ""}
        <p class="location-meta"><strong>📍 Координати:</strong> ${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}</p>
        <p class="location-meta"><strong>👤 Собственик:</strong> ${own ? "Вие" : "Друг потребител"}</p>
        ${imageUrl ? `<img class="location-image" src="${imageUrl}" alt="Снимка на локация" />` : ""}
      </article>`;
    })
    .join("");

  attachMobileLocationCardAnimation();
}

function splitDescriptionForMobile(text) {
  const full = String(text || "").trim();
  if (!full) {
    return {
      full: "Без описание",
      preview: "Без описание",
      hasMore: false,
    };
  }

  const sentenceEndMatch = full.match(/[.!?](\s|$)/);
  if (!sentenceEndMatch || typeof sentenceEndMatch.index !== "number") {
    return {
      full,
      preview: full,
      hasMore: false,
    };
  }

  const firstSentenceEnd = sentenceEndMatch.index + 1;
  const preview = full.slice(0, firstSentenceEnd).trim();
  const rest = full.slice(firstSentenceEnd).trim();

  return {
    full,
    preview: preview || full,
    hasMore: rest.length > 0,
  };
}

function toggleLocationDescription(locationId) {
  if (state.expandedDescriptionIds.has(locationId)) {
    state.expandedDescriptionIds.delete(locationId);
  } else {
    state.expandedDescriptionIds.add(locationId);
  }

  renderCards();
}

function attachMobileLocationCardAnimation() {
  const cards = Array.from(elements.locationsList.querySelectorAll(".location-card"));
  if (!cards.length) {
    return;
  }

  if (window.innerWidth > 768) {
    if (mobileLocationCardObserver) {
      mobileLocationCardObserver.disconnect();
    }
    cards.forEach((card) => {
      card.classList.remove("location-card-mobile-reveal", "is-visible");
    });
    return;
  }

  if (mobileLocationCardObserver) {
    mobileLocationCardObserver.disconnect();
  }

  mobileLocationCardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        } else {
          entry.target.classList.remove("is-visible");
        }
      });
    },
    {
      root: null,
      threshold: 0.18,
      rootMargin: "0px 0px -10% 0px",
    }
  );

  cards.forEach((card, index) => {
    card.classList.add("location-card-mobile-reveal");
    card.classList.remove("is-visible");
    card.style.transitionDelay = `${Math.min(index, 4) * 30}ms`;
    mobileLocationCardObserver.observe(card);
  });
}

function renderMarkers() {
  state.markersById.forEach((marker) => map.removeLayer(marker));
  state.markersById.clear();

  state.locations.forEach((location) => {
    const mountain = location.mountain || "Непосочена планина";
    const season = location.season || "Сезон 2015";
    const formattedDate = formatBgDate(location.visit_date);
    const popupImageUrl = resolveImagePathToUrl(location.popup_image_path) || firstImageUrl(location);
    const elevationText = Number.isFinite(location.elevation_m) ? `${location.elevation_m} м` : "Без данни";
    const marker = L.marker([location.latitude, location.longitude]).addTo(map);
    marker.bindPopup(
      `
      <div class="marker-popup">
        <strong>📍 ${escapeHtml(location.title)}</strong><br>
        <span>⛰️ ${escapeHtml(elevationText)}</span><br>
        <span>🏔️ ${escapeHtml(mountain)}</span><br>
        <span>🍂 ${escapeHtml(season)}</span><br>
        <span>📅 ${escapeHtml(formattedDate)}</span>
        ${popupImageUrl ? `<img class="marker-popup-image" src="${popupImageUrl}" alt="Снимка от изкачването" />` : ""}
      </div>
      `
    );
    marker.on("popupopen", (event) => {
      setMobileMapSearchVisibility(false);
      adjustMarkerPopupForMobile(event.popup);
    });
    marker.on("popupclose", () => {
      setMobileMapSearchVisibility(true);
    });
    marker.on("click", () => {
      highlightLocation(location.id, true);
    });
    state.markersById.set(location.id, marker);
  });
}

function setMobileMapSearchVisibility(isVisible) {
  if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
    return;
  }

  const mapSearchControl = document.querySelector(".map-search-control");
  if (!(mapSearchControl instanceof HTMLElement)) {
    return;
  }

  mapSearchControl.classList.toggle("is-mobile-hidden", !isVisible);
}

function adjustMarkerPopupForMobile(popup) {
  if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches || !popup) {
    return;
  }

  const refreshPopupLayout = () => {
    popup.update();
  };

  requestAnimationFrame(refreshPopupLayout);

  const popupElement = popup.getElement();
  if (!popupElement) {
    return;
  }

  const popupImage = popupElement.querySelector(".marker-popup-image");
  if (!(popupImage instanceof HTMLImageElement)) {
    return;
  }

  if (popupImage.complete) {
    requestAnimationFrame(refreshPopupLayout);
    return;
  }

  popupImage.addEventListener("load", refreshPopupLayout, { once: true });
}

function highlightLocation(locationId, scrollIntoView = false) {
  state.selectedId = locationId;
  renderCards();

  if (scrollIntoView) {
    const selectedCard = elements.locationsList.querySelector(`.location-card[data-id="${locationId}"]`);
    if (selectedCard) {
      selectedCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
}

function focusLocationOnMap(locationId, fromCardClick = false) {
  const location = state.locations.find((item) => item.id === locationId);
  const marker = state.markersById.get(locationId);
  if (!location || !marker) {
    return;
  }

  highlightLocation(locationId, !fromCardClick);

  const focusMarker = () => {
    map.invalidateSize();
    map.flyTo([location.latitude, location.longitude], 13, { duration: 0.6 });
    map.once("moveend", () => {
      marker.openPopup();
    });
  };

  const shouldScrollToMap = fromCardClick && window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  if (!shouldScrollToMap) {
    focusMarker();
    return;
  }

  const mapSection = document.querySelector(".map-section");
  if (mapSection instanceof HTMLElement) {
    const heroBanner = document.querySelector(".hero-banner");
    const headerHeight = heroBanner instanceof HTMLElement ? heroBanner.offsetHeight : 0;
    const sectionTop = window.scrollY + mapSection.getBoundingClientRect().top;
    const targetTop = Math.max(sectionTop - headerHeight - 8, 0);
    window.scrollTo({ top: targetTop, behavior: "smooth" });
  }

  window.setTimeout(focusMarker, 320);
}

function handleMapClick(event) {
  if (!state.user) {
    alert("Трябва да влезете в профила си, за да добавяте локации.");
    return;
  }

  if (state.currentRole === "visitors") {
    alert("Профилът ви изчаква одобрение от администратор. След одобрение ще можете да публикувате локации.");
    return;
  }

  const lat = event.latlng.lat;
  const lng = event.latlng.lng;

  const popupHtml = `
    <form id="create-location-form" class="popup-form" novalidate>
      <label>Заглавие
        <input id="create-title" required />
      </label>
      <label>Височина (м)
        <input id="create-elevation" type="number" step="1" />
      </label>
      <label>Планина
        <input id="create-mountain" placeholder="Например Пирин" />
      </label>
      <label>Описание
        <textarea id="create-description" rows="3" placeholder="Кратка информация"></textarea>
      </label>
      <label>Сезон
        <select id="create-season" required>
          ${SEASONS.map((season) => `<option value="${season}">${season}</option>`).join("")}
        </select>
      </label>
      <label>Дата
        <input id="create-visit-date" type="text" placeholder="dd/mm/yyyy" inputmode="numeric" />
      </label>
      <label>Снимка в popup (по избор)
        <input id="create-popup-image" type="file" accept="image/*" />
      </label>
      <label>Титулна снимка (дясно поле Локации)
        <input id="create-title-image" type="file" accept="image/*" />
      </label>
      <label>Други снимки за локацията
        <input id="create-gallery-images" type="file" accept="image/*" multiple />
      </label>
      <button class="btn" type="submit">Запази локация</button>
    </form>
  `;

  const popup = L.popup({ className: "create-location-popup", maxWidth: 620 }).setLatLng(event.latlng).setContent(popupHtml).openOn(map);

  setTimeout(() => {
    const form = document.getElementById("create-location-form");
    if (!form) {
      return;
    }

    const elevationInput = document.getElementById("create-elevation");
    if (elevationInput) {
      elevationInput.value = "";
      fetchElevationMeters(lat, lng).then((elevationM) => {
        elevationInput.value = Number.isFinite(elevationM) ? String(elevationM) : "";
      });
    }

    form.addEventListener("submit", async (submitEvent) => {
      submitEvent.preventDefault();

      if (state.isCreatingLocation) {
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = true;
        submitButton.textContent = "Запис...";
      }

      state.isCreatingLocation = true;

      try {
        const title = document.getElementById("create-title").value.trim();
        const mountain = document.getElementById("create-mountain").value.trim();
        const description = document.getElementById("create-description").value.trim();
        const season = document.getElementById("create-season").value;
        const rawVisitDate = (document.getElementById("create-visit-date")?.value || "").trim();
        const visitDate = parseDdMmYyyyToIso(rawVisitDate);
        if (!rawVisitDate || !visitDate) {
          alert("Моля, въведете валидна дата във формат dd/mm/yyyy.");
          return;
        }
        const popupImageFile = document.getElementById("create-popup-image")?.files?.[0] || null;
        const titleImageFile = document.getElementById("create-title-image")?.files?.[0] || null;
        const galleryFileList = document.getElementById("create-gallery-images")?.files;
        const galleryFiles = galleryFileList ? Array.from(galleryFileList) : [];
        const elevationM = parseOptionalInteger(document.getElementById("create-elevation")?.value);

        const isCreated = await createLocation({
          title,
          mountain,
          description,
          season,
          visitDate,
          latitude: lat,
          longitude: lng,
          elevationM,
          popupImageFile,
          titleImageFile,
          galleryFiles,
        });
        if (isCreated) {
          map.closePopup(popup);
        }
      } finally {
        state.isCreatingLocation = false;
        if (submitButton instanceof HTMLButtonElement && document.body.contains(submitButton)) {
          submitButton.disabled = false;
          submitButton.textContent = "Запази локация";
        }
      }
    });
  }, 0);
}

async function createLocation({ title, mountain, description, season, visitDate, latitude, longitude, elevationM, popupImageFile, titleImageFile, galleryFiles }) {
  if (!title) {
    alert("Заглавието е задължително.");
    return false;
  }

  if (!SEASONS.includes(season)) {
    alert("Моля, изберете валиден сезон.");
    return false;
  }

  if (state.currentRole === "visitors") {
    alert("Профилът ви изчаква одобрение от администратор за публикуване на локации.");
    return false;
  }

  if (!state.userListId) {
    await ensureUserList();
    if (!state.userListId) {
      return false;
    }
  }

  await ensureLocationFolder(title, visitDate);

  const popupImagePath = popupImageFile ? await uploadImage(popupImageFile, title, visitDate) : null;
  const titleImagePath = titleImageFile ? await uploadImage(titleImageFile, title, visitDate) : null;
  const imagePaths = await uploadImages(galleryFiles || [], title, visitDate);

  const { error } = await supabaseClient.from("locations").insert({
    list_id: state.userListId,
    owner_user_id: state.user.id,
    title,
    mountain: mountain || null,
    description: description || null,
    season,
    visit_date: visitDate,
    latitude,
    longitude,
    elevation_m: elevationM,
    popup_image_path: popupImagePath,
    title_image_path: titleImagePath,
    image_paths: imagePaths,
  });

  if (error) {
    alert(`Грешка при добавяне: ${error.message}`);
    return false;
  }

  await loadLocations();
  return true;
}

function openViewPopup(location) {
  const imageUrl = firstImageUrl(location);
  const content = `
    <p><strong>📍 Заглавие:</strong> ${escapeHtml(location.title)}</p>
    ${Number.isFinite(location.elevation_m) ? `<p><strong>⛰️ Височина:</strong> ${location.elevation_m} м</p>` : ""}
    <p><strong>🏔️ Планина:</strong> ${escapeHtml(location.mountain || "Непосочена планина")}</p>
    <p><strong>📝 Описание:</strong> ${escapeHtml(location.description || "Без описание")}</p>
    <p><strong>🍂 Сезон:</strong> ${escapeHtml(location.season || "Сезон 2015")}</p>
    ${location.visit_date ? `<p><strong>📅 Дата:</strong> ${escapeHtml(formatBgDate(location.visit_date))}</p>` : ""}
    <p><strong>📍 Координати:</strong> ${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)}</p>
    ${imageUrl ? `<img class="location-image" src="${imageUrl}" alt="Снимка на локация" />` : "<p>Няма снимка.</p>"}
  `;

  openModal("Преглед на локация", content, [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
}

function openGalleryPopup(location) {
  const imageUrls = getImageUrls(location);
  if (!imageUrls.length) {
    openModal("Снимки", "<p>Няма налични снимки.</p>", [{ text: "Затвори", className: "btn btn-secondary", onClick: closeModal }]);
    return;
  }

  if (state.galleryAutoplayTimerId) {
    clearInterval(state.galleryAutoplayTimerId);
    state.galleryAutoplayTimerId = null;
  }

  let currentIndex = 0;
  let isAutoplay = false;

  const stopAutoplay = () => {
    if (state.galleryAutoplayTimerId) {
      clearInterval(state.galleryAutoplayTimerId);
      state.galleryAutoplayTimerId = null;
    }
    isAutoplay = false;
  };

  const startAutoplay = () => {
    if (state.galleryAutoplayTimerId) {
      return;
    }

    isAutoplay = true;
    state.galleryAutoplayTimerId = setInterval(() => {
      currentIndex = (currentIndex + 1) % imageUrls.length;
      renderGallery();
    }, 5000);
  };

  const updateAutoplayButtonLabel = () => {
    const autoplayButton = elements.modalActions?.children?.[2];
    if (autoplayButton instanceof HTMLButtonElement) {
      autoplayButton.textContent = isAutoplay ? "⏸️ Спри авто" : "▶️ Авто (5 сек)";
    }
  };

  const titleText = `🖼️ Снимки: ${escapeHtml(location.title)}`;
  const content = `
    <div class="gallery-view">
      <img id="gallery-main-image" class="location-image gallery-image" src="" alt="" />
      <p id="gallery-meta-row" class="gallery-meta-row"></p>
      <p id="gallery-position" class="location-meta"></p>
    </div>
  `;

  openModal(titleText, content, [
    {
      text: "Предишна",
      className: "btn btn-secondary",
      onClick: () => {
        currentIndex = (currentIndex - 1 + imageUrls.length) % imageUrls.length;
        renderGallery();
      },
    },
    {
      text: "Следваща",
      className: "btn btn-secondary",
      onClick: () => {
        currentIndex = (currentIndex + 1) % imageUrls.length;
        renderGallery();
      },
    },
    {
      text: "▶️ Авто (5 сек)",
      className: "btn btn-secondary",
      onClick: () => {
        if (isAutoplay) {
          stopAutoplay();
        } else {
          startAutoplay();
        }
        updateAutoplayButtonLabel();
      },
    },
    {
      text: "На цял екран",
      className: "btn btn-secondary",
      onClick: async () => {
        await toggleGalleryFullscreen();
      },
    },
    {
      text: "Затвори",
      className: "btn",
      onClick: () => {
        stopAutoplay();
        closeModal();
      },
    },
  ]);

  elements.modalContent?.classList.add("modal-content-gallery");

  const renderGallery = () => {
    const currentUrl = imageUrls[currentIndex];
    const seasonText = location.season || "Сезон 2015";
    const dateText = formatBgDate(location.visit_date);
    const mainImage = document.getElementById("gallery-main-image");
    const metaRow = document.getElementById("gallery-meta-row");
    const positionRow = document.getElementById("gallery-position");

    if (mainImage instanceof HTMLImageElement) {
      mainImage.src = currentUrl;
      mainImage.alt = `Снимка ${currentIndex + 1}`;
    }

    if (metaRow) {
      metaRow.innerHTML = `<span>🍂 ${escapeHtml(seasonText)}</span><span>📅 ${escapeHtml(dateText)}</span>`;
    }

    if (positionRow) {
      positionRow.textContent = `🖼️ Снимка ${currentIndex + 1} от ${imageUrls.length}`;
    }

    updateAutoplayButtonLabel();
  };

  const mainImage = document.getElementById("gallery-main-image");
  if (mainImage) {
    mainImage.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % imageUrls.length;
      renderGallery();
    });
  }

  renderGallery();
}

function openEditPopup(location) {
  if (location.owner_user_id !== state.user?.id) {
    alert("Можете да редактирате само вашите локации.");
    return;
  }

  const content = `
    <form id="edit-form" class="edit-form">
      <label>Заглавие
        <input id="edit-title" value="${escapeHtmlAttr(location.title)}" required />
      </label>
      <label>Височина (м)
        <input id="edit-elevation" type="number" step="1" value="${Number.isFinite(location.elevation_m) ? location.elevation_m : ""}" />
      </label>
      <label>Планина
        <input id="edit-mountain" value="${escapeHtmlAttr(location.mountain || "")}" placeholder="Например Пирин" />
      </label>
      <label>Описание
        <textarea id="edit-description" rows="3">${escapeHtml(location.description || "")}</textarea>
      </label>
      <label>Сезон
        <select id="edit-season" required>
          ${SEASONS.map((season) => `<option value="${season}" ${season === (location.season || "Сезон 2015") ? "selected" : ""}>${season}</option>`).join("")}
        </select>
      </label>
      <label>Ширина (latitude)
        <input id="edit-latitude" type="number" step="any" value="${location.latitude}" required />
      </label>
      <label>Дължина (longitude)
        <input id="edit-longitude" type="number" step="any" value="${location.longitude}" required />
      </label>
      <label>Снимка в popup (по избор)
        <input id="edit-popup-image" type="file" accept="image/*" />
      </label>
      <label>Титулна снимка (дясно поле Локации)
        <input id="edit-title-image" type="file" accept="image/*" />
      </label>
      <label>Други снимки за локацията
        <input id="edit-gallery-images" type="file" accept="image/*" multiple />
      </label>
    </form>
  `;

  openModal("Редакция на локация", content, [
    { text: "Отказ", className: "btn btn-secondary", onClick: closeModal },
    {
      text: "Запази",
      className: "btn",
      onClick: async () => {
        const title = document.getElementById("edit-title").value.trim();
        const mountain = document.getElementById("edit-mountain").value.trim();
        const description = document.getElementById("edit-description").value.trim();
        const season = document.getElementById("edit-season").value;
        const latitude = Number(document.getElementById("edit-latitude").value);
        const longitude = Number(document.getElementById("edit-longitude").value);
        const elevationM = parseOptionalInteger(document.getElementById("edit-elevation")?.value);
        const popupImageFile = document.getElementById("edit-popup-image")?.files?.[0] || null;
        const titleImageFile = document.getElementById("edit-title-image")?.files?.[0] || null;
        const galleryFileList = document.getElementById("edit-gallery-images")?.files;
        const galleryFiles = galleryFileList ? Array.from(galleryFileList) : [];

        await updateLocation(location, {
          title,
          mountain,
          description,
          season,
          latitude,
          longitude,
          elevationM,
          popupImageFile,
          titleImageFile,
          galleryFiles,
        });
      },
    },
  ]);

  const latInput = document.getElementById("edit-latitude");
  const lngInput = document.getElementById("edit-longitude");
  const elevationInput = document.getElementById("edit-elevation");
  if (latInput && lngInput && elevationInput) {
    const updateElevation = async () => {
      const lat = Number(latInput.value);
      const lng = Number(lngInput.value);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        elevationInput.value = "";
        return;
      }
      const elevationM = await fetchElevationMeters(lat, lng);
      elevationInput.value = Number.isFinite(elevationM) ? String(elevationM) : "";
    };

    latInput.addEventListener("change", updateElevation);
    lngInput.addEventListener("change", updateElevation);
  }
}

function openDeletePopup(location) {
  if (location.owner_user_id !== state.user?.id) {
    alert("Можете да изтривате само вашите локации.");
    return;
  }

  openModal(
    "Изтриване на локация",
    `<p>Сигурни ли сте, че искате да изтриете „${escapeHtml(location.title)}“?</p>`,
    [
      { text: "Отказ", className: "btn btn-secondary", onClick: closeModal },
      {
        text: "Изтрий",
        className: "btn",
        onClick: async () => {
          const { error } = await supabaseClient.from("locations").delete().eq("id", location.id);
          if (error) {
            alert(`Грешка при изтриване: ${error.message}`);
            return;
          }
          closeModal();
          await loadLocations();
        },
      },
    ]
  );
}

async function updateLocation(location, { title, mountain, description, season, latitude, longitude, elevationM, popupImageFile, titleImageFile, galleryFiles }) {
  if (!title || Number.isNaN(latitude) || Number.isNaN(longitude) || !SEASONS.includes(season)) {
    alert("Моля, попълнете валидни данни.");
    return;
  }

  let imagePaths = location.image_paths || [];
  let popupImagePath = location.popup_image_path || null;
  let titleImagePath = location.title_image_path || null;

  const folderVisitDate = location.visit_date || null;

  await ensureLocationFolder(title, folderVisitDate);

  if (galleryFiles?.length) {
    const uploadedGalleryPaths = await uploadImages(galleryFiles, title, folderVisitDate);
    if (uploadedGalleryPaths.length) {
      imagePaths = uploadedGalleryPaths;
    }
  }

  if (popupImageFile) {
    const uploadedPopupPath = await uploadImage(popupImageFile, title, folderVisitDate);
    if (uploadedPopupPath) {
      popupImagePath = uploadedPopupPath;
    }
  }

  if (titleImageFile) {
    const uploadedTitlePath = await uploadImage(titleImageFile, title, folderVisitDate);
    if (uploadedTitlePath) {
      titleImagePath = uploadedTitlePath;
    }
  }

  const { error } = await supabaseClient
    .from("locations")
    .update({
      title,
      mountain: mountain || null,
      description: description || null,
      season,
      latitude,
      longitude,
      elevation_m: elevationM,
      image_paths: imagePaths,
      popup_image_path: popupImagePath,
      title_image_path: titleImagePath,
    })
    .eq("id", location.id);

  if (error) {
    alert(`Грешка при редакция: ${error.message}`);
    return;
  }

  closeModal();
  await loadLocations();
}

async function ensureLocationFolder(locationTitle, visitDate) {
  const folderName = buildLocationFolderName(locationTitle, visitDate);
  const functionResult = await supabaseClient.functions.invoke("ensure-location-folder", {
    body: { folderName },
  });

  if (!functionResult.error) {
    return;
  }

  if (functionResult.error?.context?.status === 401 || functionResult.error?.context?.status === 403) {
    return;
  }

  const placeholderPath = `public/${folderName}/.emptyFolderPlaceholder`;
  const fallbackResult = await supabaseClient.storage
    .from("location-images")
    .upload(placeholderPath, new Blob([]), {
      contentType: "application/octet-stream",
      upsert: true,
      cacheControl: "3600",
    });

  if (fallbackResult.error) {
    console.warn("Неуспешно предварително създаване на папка:", functionResult.error.message);
  }
}

async function uploadImage(file, locationTitle, visitDate) {
  if (!state.user) {
    return null;
  }

  const folderName = buildLocationFolderName(locationTitle, visitDate);
  const safeName = `${Date.now()}-${buildSafeFileName(file.name)}`;
  const path = `public/${folderName}/${safeName}`;

  const { error } = await supabaseClient.storage.from("location-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    alert(`Грешка при качване на снимка: ${error.message}`);
    return null;
  }

  return path;
}

async function uploadImages(files, locationTitle, visitDate) {
  if (!files?.length) {
    return [];
  }

  const uploadedPaths = [];
  for (const file of files) {
    const uploadedPath = await uploadImage(file, locationTitle, visitDate);
    if (uploadedPath) {
      uploadedPaths.push(uploadedPath);
    }
  }

  return uploadedPaths;
}

function buildLocationFolderName(locationTitle, visitDate) {
  const raw = String(locationTitle || "location")
    .trim()
    .replace(/^връх\s+/i, "");

  const transliterated = transliterateBulgarian(raw);

  const normalizedName = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const baseName = normalizedName || "Location";
  const formattedName = `${baseName.charAt(0).toUpperCase()}${baseName.slice(1).toLowerCase()}`;
  const datePart = formatIsoDateToFolderPart(visitDate);

  return datePart ? `${formattedName} ${datePart}` : formattedName;
}

async function persistSearchedElevation(query, elevationM) {
  if (!Number.isFinite(elevationM)) {
    return;
  }

  const matchedLocation = findMatchedLocationByQuery(query);
  if (!matchedLocation) {
    return;
  }

  if (Number.isFinite(matchedLocation.elevation_m) || matchedLocation.elevation_m === elevationM) {
    return;
  }

  const { error } = await supabaseClient.from("locations").update({ elevation_m: elevationM }).eq("id", matchedLocation.id);
  if (error) {
    return;
  }

  matchedLocation.elevation_m = elevationM;
  renderLocationsAndPins();
}

function normalizeLocationTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^връх\s+/i, "")
    .replace(/\s+/g, " ");
}

function findMatchedLocationByQuery(query) {
  const normalizedQuery = normalizeLocationTitle(query);
  if (!normalizedQuery) {
    return null;
  }

  return state.locations.find((location) => normalizeLocationTitle(location.title) === normalizedQuery) || null;
}

function extractElevationFromTexts(...texts) {
  for (const text of texts) {
    const match = String(text || "").match(/(\d{3,4})(?:[.,]\d+)?\s*[мm]\b/i);
    if (match) {
      const elevation = Number(match[1]);
      if (Number.isFinite(elevation)) {
        return elevation;
      }
    }
  }

  return null;
}

function buildSafeFileName(fileName) {
  const original = String(fileName || "file");
  const lower = transliterateBulgarian(original.toLowerCase());
  const extMatch = lower.match(/(\.[a-z0-9]+)$/);
  const extension = extMatch ? extMatch[1] : "";
  const base = extension ? lower.slice(0, -extension.length) : lower;

  const safeBase = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${safeBase || "file"}${extension}`;
}

function transliterateBulgarian(value) {
  const map = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "y",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "ts",
    "ч": "ch",
    "ш": "sh",
    "щ": "sht",
    "ъ": "a",
    "ь": "y",
    "ю": "yu",
    "я": "ya",
  };

  return String(value)
    .split("")
    .map((char) => {
      const mapped = map[char.toLowerCase()];
      return mapped || char;
    })
    .join("");
}

function titleImageUrl(location) {
  return resolveImagePathToUrl(location.title_image_path);
}

function firstImageUrl(location) {
  const urls = getImageUrls(location);
  return urls[0] || "";
}

function getImageUrls(location) {
  if (!location.image_paths?.length) {
    return [];
  }

  return location.image_paths.map((path) => resolveImagePathToUrl(path)).filter(Boolean);
}

function resolveImagePathToUrl(path) {
  if (!path) {
    return "";
  }

  if (path.startsWith("Images/") || path.startsWith("Images\\")) {
    return path.replaceAll("\\", "/");
  }

  const { data } = supabaseClient.storage.from("location-images").getPublicUrl(path);
  return data?.publicUrl || "";
}

function getShortDescription(description) {
  const text = (description || "").trim();
  if (!text) {
    return "Без описание";
  }

  const normalized = text.replace(/\s+/g, " ");
  if (normalized.length <= 140) {
    return normalized;
  }

  return `${normalized.slice(0, 140).trimEnd()}...`;
}

function formatBgDate(isoDate) {
  if (!isoDate) {
    return "Без дата";
  }

  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}-${month}-${year}`;
  }

  const date = new Date(String(isoDate));
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function parseDdMmYyyyToIso(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, dayPart, monthPart, yearPart] = match;
  const day = Number(dayPart);
  const month = Number(monthPart);
  const year = Number(yearPart);

  const date = new Date(year, month - 1, day);
  const isValidDate =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;

  if (!isValidDate) {
    return null;
  }

  return `${yearPart}-${monthPart}-${dayPart}`;
}

function formatIsoDateToFolderPart(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return "";
  }

  const [, year, month, day] = match;
  return `${day}.${month}.${year}`;
}

async function toggleGalleryFullscreen() {
  const galleryImage = document.getElementById("gallery-main-image");
  if (!galleryImage) {
    return;
  }

  if (!document.fullscreenElement) {
    if (galleryImage.requestFullscreen) {
      await galleryImage.requestFullscreen();
    }
    return;
  }

  if (document.exitFullscreen) {
    await document.exitFullscreen();
  }
}

function openModal(title, bodyHtml, actions) {
  elements.modalContent?.classList.remove("modal-content-gallery");
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = bodyHtml;
  elements.modalActions.innerHTML = "";

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action.text;
    button.className = action.className || "btn";
    button.addEventListener("click", action.onClick);
    elements.modalActions.appendChild(button);
  });

  elements.modal.classList.remove("hidden");
}

function closeModal() {
  if (state.galleryAutoplayTimerId) {
    clearInterval(state.galleryAutoplayTimerId);
    state.galleryAutoplayTimerId = null;
  }

  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  elements.modalContent?.classList.remove("modal-content-gallery");
  elements.modal.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function fetchElevationMeters(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
    );
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const elevation = Array.isArray(payload?.elevation) ? payload.elevation[0] : null;
    if (!Number.isFinite(elevation)) {
      return null;
    }

    return Math.round(elevation);
  } catch {
    return null;
  }
}

function parseOptionalInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
}
