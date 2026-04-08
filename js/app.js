import { AppState, DOM, SURAH_META, ICONS, getActiveFeed } from './store.js';
import { playAudio, stopAudio, toggleAutoPlay, populateVoiceList } from './audio.js';

let bannerShowTimeout;
let bannerHideTimeout;

// ==========================================
// 1. PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.log('Service Worker registration failed: ', err);
        });
    });
}

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// ==========================================
// 2. INITIALIZATION & ROUTING
// ==========================================
window.onload = async () => {
    initSettings();
    renderBookmarks();
    initHeaderAutomations();
    initFeedDelegation();
    initScrollingFades();
    initScrubbing();
    initNavTooltips();
    initGestureInterrupts();

    await fetchQuranData();

    const hash = window.location.hash;
    if (hash.startsWith('#surah-')) displaySurah(hash.replace('#surah-', ''));
    else if (hash === '#settings') displaySettings();
    else displayHome();
};

window.addEventListener('popstate', (e) => {
    if (e.state && e.state.view === 'surah') displaySurah(e.state.index, e.state.targetVerse);
    else if (e.state && e.state.view === 'settings') displaySettings();
    else displayHome();
});

// ==========================================
// 3. DATA LOADING
// ==========================================
async function fetchQuranData() {
    try {
        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('loading').innerText = "Loading library...";

        const [transRes, arabicRes] = await Promise.all([
            fetch(AppState.translationFile), fetch('quran-simple.xml')
        ]);

        if (!transRes.ok || !arabicRes.ok) throw new Error("Files not found");

        const parser = new DOMParser();
        AppState.quranXML = parser.parseFromString(await transRes.text(), "text/xml");
        AppState.arabicXML = parser.parseFromString(await arabicRes.text(), "text/xml");

        document.getElementById('loading').classList.add('hidden');
        renderLibraryList();
    } catch (e) {
        document.getElementById('loading').innerText = `Error loading library.`;
    }
}

function renderLibraryList() {
    const list = document.getElementById('surah-list');
    list.innerHTML = '';
    AppState.quranXML.querySelectorAll('sura').forEach(sura => {
        const index = parseInt(sura.getAttribute('index'));
        const meta = SURAH_META[index - 1];

        const li = document.createElement('li');
        li.className = 'surah-item';
        li.innerHTML = `
            <div class="surah-item-info">
                <span class="surah-name">${index}. ${meta.name}</span>
                <span class="surah-translation">${meta.translation}</span>
            </div><span style="opacity: 0.3;">›</span>`;
        li.onclick = () => openSurah(index);
        list.appendChild(li);
    });
}

// ==========================================
// 4. VIEW CONTROLLERS & RENDERING 
// ==========================================
function openSurah(index, targetVerse = null) {
    history.pushState({ view: 'surah', index: index, targetVerse: targetVerse }, '', `#surah-${index}`);
    displaySurah(index, targetVerse);
}

function displaySurah(index, targetVerse = null) {
    haltAllAutomations();
    resetReadingEnvironment();
    AppState.preventSave = true;

    AppState.currentSurahIndex = parseInt(index);
    const transSuraNode = AppState.quranXML.querySelector(`sura[index="${index}"]`);
    const arabicSuraNode = AppState.arabicXML.querySelector(`sura[index="${index}"]`);

    if (!transSuraNode || !arabicSuraNode) return displayHome();

    AppState.currentArabicSurahName = arabicSuraNode.getAttribute('name');
    const meta = SURAH_META[AppState.currentSurahIndex - 1];

    updateNavigationUI(index);
    switchViewTo('surah');
    document.title = `Surah ${meta.name} - The Qur'an`;
    updateTabUI(AppState.currentTab);

    triggerGestureHint();
    buildSurahDOM(index, transSuraNode, arabicSuraNode, meta);

    setTimeout(() => {
        if (targetVerse) {
            scrollToVerse(targetVerse);
            AppState.savedPositions[index] = targetVerse;
            localStorage.setItem('quran_positions', JSON.stringify(AppState.savedPositions));
            setTimeout(() => { AppState.preventSave = false; }, 250);
        } else {
            DOM.tabCarousel.scrollTo({ left: AppState.currentTab === 'arabic' ? window.innerWidth : 0, top: 0, behavior: 'auto' });
            DOM.transFeed.style.scrollBehavior = 'smooth';
            DOM.arabicFeed.style.scrollBehavior = 'smooth';

            let savedVerse = AppState.savedPositions[index];
            if (savedVerse && savedVerse !== '1' && savedVerse !== 'bismillah') {
                showContinueBanner(savedVerse);
            }
        }
        updateProgressBar();
    }, 50);
}

function buildSurahDOM(surahIndex, transNode, arabicNode, meta) {
    setupScrollSpy(surahIndex);

    const transFragment = document.createDocumentFragment();
    const arabicFragment = document.createDocumentFragment();

    if (surahIndex > 1 && surahIndex !== 9) {
        const firstAyaAr = arabicNode.querySelector('aya[index="1"]');
        const bTextAr = (firstAyaAr && firstAyaAr.getAttribute('bismillah')) ? firstAyaAr.getAttribute('bismillah') : "بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ";
        const bTextEn = AppState.quranXML.querySelector('sura[index="1"] aya[index="1"]')?.getAttribute('text') || "In the name of God, the Gracious, the Merciful.";

        const tBismillah = createVerseDOM(bTextEn, 'bismillah', false, meta.name, surahIndex, false);
        const aBismillah = createVerseDOM(bTextAr, 'bismillah', false, meta.name, surahIndex, true);

        transFragment.appendChild(tBismillah);
        arabicFragment.appendChild(aBismillah);

        AppState.verseObserver.observe(tBismillah);
        AppState.verseObserver.observe(aBismillah);
    }

    const transAyas = Array.from(transNode.querySelectorAll('aya'));
    const arabicAyas = Array.from(arabicNode.querySelectorAll('aya'));

    transAyas.forEach((transAya, i) => {
        const verseIndex = transAya.getAttribute('index');
        const isSaved = AppState.bookmarks.some(b => b.surah == surahIndex && b.verse == verseIndex);
        const arText = arabicAyas[i] ? arabicAyas[i].getAttribute('text') : "Text missing";
        const enText = transAya.getAttribute('text');

        const tVerse = createVerseDOM(enText, verseIndex, isSaved, meta.name, surahIndex, false);
        const aVerse = createVerseDOM(arText, verseIndex, isSaved, meta.name, surahIndex, true);

        transFragment.appendChild(tVerse);
        arabicFragment.appendChild(aVerse);

        AppState.verseObserver.observe(tVerse);
        AppState.verseObserver.observe(aVerse);
    });

    DOM.transFeed.appendChild(transFragment);
    DOM.arabicFeed.appendChild(arabicFragment);
}

function createVerseDOM(text, verseIndex, isSaved, metaName, sIdx, isArabic) {
    const screen = document.createElement('div');
    screen.className = 'verse-screen';
    screen.dataset.verse = verseIndex;

    let tClass = text.length > 700 ? 'extra-long-verse' : (text.length > 350 ? 'long-verse' : '');
    const arClass = isArabic ? 'verse-text-arabic' : '';

    screen.innerHTML = `
        <div class="verse-text ${arClass} ${tClass}">${text}</div>
        <div class="verse-actions">
            <button class="icon-btn bookmark-btn ${isSaved ? 'active' : ''}" data-action="bookmark" data-verse="${verseIndex}" aria-label="Bookmark">${ICONS.bookmark}</button>
            <div class="play-pill">
                <button class="pill-btn play-btn" data-action="play" data-verse="${verseIndex}" aria-label="Play Audio">${ICONS.play}</button>
                <div class="pill-divider"></div>
                <button class="pill-btn autoplay-toggle ${AppState.autoAdvanceAudio ? 'active' : ''}" data-action="autoplay" aria-label="Auto Play">${ICONS.autoplay}</button>
            </div>
        </div>`;
    return screen;
}

// ==========================================
// 5. EVENT DELEGATION SYSTEM
// ==========================================
function initFeedDelegation() {
    const handleAction = (e, isLongPress) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const verse = btn.dataset.verse;
        const sIdx = AppState.currentSurahIndex;
        const metaName = SURAH_META[sIdx - 1].name;

        if (isLongPress) {
            if (action === 'bookmark') showToast("Bookmark Verse");
            if (action === 'play') showToast("Play Verse Audio");
            if (action === 'autoplay') showToast("Toggle Auto-Advance");
            if (navigator.vibrate) navigator.vibrate(50);
            return;
        }

        if (action === 'bookmark') toggleBookmark(sIdx, verse, metaName, btn);
        if (action === 'play') playAudio(sIdx, verse);
        if (action === 'autoplay') toggleAutoPlay(null, false, showToast);
    };

    [DOM.transFeed, DOM.arabicFeed].forEach(feed => {
        feed.addEventListener('click', (e) => handleAction(e, false));

        let timer;
        const start = (e) => {
            const btn = e.target.closest('button[data-action]');
            if (btn) timer = setTimeout(() => handleAction(e, true), 500);
        };
        const cancel = () => clearTimeout(timer);

        ['touchstart', 'mousedown'].forEach(evt => feed.addEventListener(evt, start, { passive: true }));
        ['touchend', 'mouseup', 'mouseleave', 'touchmove'].forEach(evt => feed.addEventListener(evt, cancel, { passive: true }));
        feed.addEventListener('contextmenu', e => {
            if (e.target.closest('button[data-action]')) e.preventDefault();
        });
    });
}

// ==========================================
// 6. OBSERVERS & SCROLL SYNC
// ==========================================
function setupScrollSpy(surahIndex) {
    AppState.verseObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const newVerse = entry.target.dataset.verse;
                const isVisibleFeed = (AppState.currentTab === 'trans' && entry.target.parentElement.id === 'trans-feed') ||
                    (AppState.currentTab === 'arabic' && entry.target.parentElement.id === 'arabic-feed');

                if (AppState.activeVerseIndex !== newVerse && isVisibleFeed) {
                    AppState.activeVerseIndex = newVerse;

                    if (!AppState.preventSave) {
                        AppState.savedPositions[surahIndex] = newVerse;
                        localStorage.setItem('quran_positions', JSON.stringify(AppState.savedPositions));
                    }

                    document.getElementById('persistent-verse-number').innerText = newVerse === 'bismillah' ? "" : `${surahIndex}:${newVerse}`;

                    const otherFeed = AppState.currentTab === 'trans' ? DOM.arabicFeed : DOM.transFeed;
                    const hiddenScreenTarget = otherFeed.querySelector(`[data-verse="${newVerse}"]`);
                    if (hiddenScreenTarget) {
                        otherFeed.scrollTo({ top: hiddenScreenTarget.offsetTop, behavior: 'auto' });
                    }

                    if (AppState.shouldAutoPlayNext) {
                        AppState.shouldAutoPlayNext = false;
                        playAudio(surahIndex, newVerse);
                    }
                    if (AppState.isAutoScrolling && !AppState.autoAdvanceAudio) {
                        triggerAutoScroll();
                    }
                }
            }
        });
    }, { rootMargin: '0px', threshold: 0.5 });
}

function scrollToVerse(verseStr) {
    const targetElEn = DOM.transFeed.querySelector(`[data-verse="${verseStr}"]`);
    const targetElAr = DOM.arabicFeed.querySelector(`[data-verse="${verseStr}"]`);
    if (targetElEn && targetElAr) {
        DOM.transFeed.scrollTo({ top: targetElEn.offsetTop, behavior: 'auto' });
        DOM.arabicFeed.scrollTo({ top: targetElAr.offsetTop, behavior: 'auto' });
    }
}

function showContinueBanner(verse) {
    const banner = document.getElementById('continue-banner');

    clearTimeout(bannerShowTimeout);
    clearTimeout(bannerHideTimeout);

    banner.innerHTML = `Continue to Verse ${verse} <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    banner.onclick = () => {
        AppState.preventSave = false;
        AppState.userHasInteracted = true;
        DOM.transFeed.style.scrollBehavior = 'smooth';
        DOM.arabicFeed.style.scrollBehavior = 'smooth';
        scrollToVerse(verse);
        hideContinueBanner(false);
    };

    banner.style.transition = 'none';
    banner.classList.remove('hidden');
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.style.transition = '';

    bannerShowTimeout = setTimeout(() => banner.classList.add('show'), 10);
}

function hideContinueBanner(instant = false) {
    const banner = document.getElementById('continue-banner');
    clearTimeout(bannerShowTimeout);
    clearTimeout(bannerHideTimeout);

    banner.classList.remove('show');

    if (instant) {
        banner.classList.add('hidden');
    } else {
        if (!banner.classList.contains('hidden')) {
            bannerHideTimeout = setTimeout(() => banner.classList.add('hidden'), 300);
        }
    }
}

function resetReadingEnvironment() {
    if (AppState.verseObserver) AppState.verseObserver.disconnect();
    AppState.activeVerseIndex = null;
    AppState.userHasInteracted = false;

    hideContinueBanner(true);

    document.querySelector('.header-assembly').classList.remove('zen-hidden-top');
    document.querySelector('.bottom-bar').classList.remove('zen-hidden-bottom');

    DOM.tabCarousel.scrollTo(0, 0);
    DOM.transFeed.style.scrollBehavior = 'auto';
    DOM.arabicFeed.style.scrollBehavior = 'auto';
    DOM.transFeed.innerHTML = '';
    DOM.arabicFeed.innerHTML = '';
    DOM.transFeed.scrollTo(0, 0);
    DOM.arabicFeed.scrollTo(0, 0);
    document.getElementById('progress-bar').style.width = '0%';

    DOM.tabCarousel.classList.remove('fade-in');
    void DOM.tabCarousel.offsetWidth;
    DOM.tabCarousel.classList.add('fade-in');
}

// ==========================================
// 7. AUTOMATIONS & GESTURES
// ==========================================
function initHeaderAutomations() {
    const autoScrollBtn = document.getElementById('header-autoscroll-btn');
    const topTitleBtn = document.getElementById('persistent-chapter-title');

    addLongPressListener(autoScrollBtn, 'Toggle Auto-Scroll');
    addLongPressListener(topTitleBtn, 'Return to Top');

    topTitleBtn.onclick = () => {
        haltAllAutomations();
        DOM.transFeed.scrollTo({ top: 0, behavior: 'smooth' });
        DOM.arabicFeed.scrollTo({ top: 0, behavior: 'smooth' });
    };

    autoScrollBtn.onclick = () => {
        AppState.isAutoScrolling = !AppState.isAutoScrolling;
        autoScrollBtn.classList.toggle('active', AppState.isAutoScrolling);

        if (AppState.isAutoScrolling) {
            if (AppState.autoAdvanceAudio) toggleAutoPlay(false, true);
            showToast("Auto-scroll Enabled");
            triggerAutoScroll();
        } else {
            showToast("Auto-scroll Disabled");
            clearTimeout(AppState.autoScrollTimer);
        }
    };

    [DOM.transFeed, DOM.arabicFeed].forEach(feed => {
        feed.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('.progress-hit-area') || e.target.closest('.verse-actions')) return;
            document.querySelector('.header-assembly').classList.toggle('zen-hidden-top');
            document.querySelector('.bottom-bar').classList.toggle('zen-hidden-bottom');
        });
    });
}

function haltAllAutomations() {
    if (AppState.currentAudioObj || window.speechSynthesis.speaking || AppState.isAutoScrolling || AppState.autoAdvanceAudio) {
        stopAudio();

        if (AppState.isAutoScrolling) {
            AppState.isAutoScrolling = false;
            clearTimeout(AppState.autoScrollTimer);
            document.getElementById('header-autoscroll-btn').classList.remove('active');
        }

        if (AppState.autoAdvanceAudio) {
            toggleAutoPlay(false, true);
        }

        AppState.shouldAutoPlayNext = false;
    }
}

function triggerAutoScroll() {
    clearTimeout(AppState.autoScrollTimer);
    const active = getActiveFeed();
    const activeScreen = active.querySelector(`[data-verse="${AppState.activeVerseIndex}"]`);
    if (!activeScreen) return;

    const words = activeScreen.querySelector('.verse-text').innerText.split(/\s+/).length;

    AppState.autoScrollTimer = setTimeout(() => {
        if (AppState.isAutoScrolling) active.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
    }, words * AppState.autoScrollSpeed);
}

function initGestureInterrupts() {
    let startY = 0, startX = 0;

    const markInteracted = () => { AppState.userHasInteracted = true; };

    const recordStart = (e) => {
        markInteracted();
        startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    };
    const checkInterrupt = (e) => {
        if (!AppState.currentAudioObj && !window.speechSynthesis.speaking && !AppState.isAutoScrolling && !AppState.autoAdvanceAudio) return;

        const currentY = e.touches[0].clientY;
        const dY = Math.abs(currentY - startY);
        const dX = Math.abs(e.touches[0].clientX - startX);

        if (dY > dX && dY > 10) {
            if (currentY > startY) haltAllAutomations();
        }
    };
    const checkWheel = (e) => {
        markInteracted();
        if (AppState.currentAudioObj || window.speechSynthesis.speaking || AppState.isAutoScrolling || AppState.autoAdvanceAudio) {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                if (e.deltaY < 0) haltAllAutomations();
            }
        }
    };

    [DOM.transFeed, DOM.arabicFeed].forEach(feed => {
        feed.addEventListener('touchstart', recordStart, { passive: true });
        feed.addEventListener('touchmove', checkInterrupt, { passive: true });
        feed.addEventListener('wheel', checkWheel, { passive: true });
        feed.addEventListener('mousedown', markInteracted, { passive: true });
    });
    document.addEventListener('keydown', markInteracted, { passive: true });
}

// ==========================================
// 8. UI HELPERS & NAVIGATION
// ==========================================
function switchViewTo(viewId) {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('surah-view').classList.add('hidden');
    document.getElementById('settings-view').classList.add('hidden');
    document.getElementById(`${viewId}-view`).classList.remove('hidden');
}

function displayHome() {
    haltAllAutomations();
    document.title = "The Qur'an";
    switchViewTo('home');
    if (AppState.verseObserver) AppState.verseObserver.disconnect();
}

function displaySettings() {
    haltAllAutomations();
    document.title = "Settings - The Qur'an";
    switchViewTo('settings');
}

function updateTabUI(tab) {
    AppState.currentTab = tab;
    document.getElementById('tab-trans').classList.toggle('active', tab === 'trans');
    document.getElementById('tab-arabic').classList.toggle('active', tab === 'arabic');

    const titleEl = document.getElementById('persistent-chapter-title');
    if (tab === 'arabic') {
        titleEl.innerText = AppState.currentArabicSurahName;
        titleEl.classList.add('arabic-mode');
    } else {
        titleEl.innerText = SURAH_META[AppState.currentSurahIndex - 1]?.name || '';
        titleEl.classList.remove('arabic-mode');
    }
    updateProgressBar();
}

function switchTabTo(tab) {
    updateTabUI(tab);
    DOM.tabCarousel.scrollTo({ left: tab === 'arabic' ? window.innerWidth : 0, behavior: 'smooth' });
}
// Make accessible to the global scope for the inline onclick handlers in index.html
window.switchTabTo = switchTabTo;

function updateNavigationUI(index) {
    document.getElementById('prev-surah-btn').classList.toggle('invisible', index <= 1);
    document.getElementById('next-surah-btn').classList.toggle('invisible', index >= 114);
}

function triggerGestureHint() {
    const swipeHint = document.getElementById('swipe-hint');
    if (!AppState.hasSwipedUp) {
        swipeHint.classList.remove('hidden', 'fade-out');
    } else {
        swipeHint.classList.add('hidden');
    }
}

function initNavTooltips() {
    addLongPressListener(document.getElementById('prev-surah-btn'), "Previous Surah");
    addLongPressListener(document.getElementById('home-btn'), "Return to Library");
    addLongPressListener(document.getElementById('next-surah-btn'), "Next Surah");
}

// ==========================================
// 9. BOOKMARKS
// ==========================================
function toggleBookmark(sIdx, vIdx, name, btnEl) {
    const exists = AppState.bookmarks.findIndex(b => b.surah == sIdx && b.verse == vIdx);
    if (exists > -1) {
        AppState.bookmarks.splice(exists, 1);
        document.querySelectorAll(`[data-verse="${vIdx}"] .bookmark-btn`).forEach(b => b.classList.remove('active'));
        showToast("Bookmark Removed");
    } else {
        AppState.bookmarks.push({ surah: sIdx, verse: vIdx, name: name });
        document.querySelectorAll(`[data-verse="${vIdx}"] .bookmark-btn`).forEach(b => b.classList.add('active'));
        showToast("Bookmark Added");
    }
    localStorage.setItem('quran_bookmarks', JSON.stringify(AppState.bookmarks));
    renderBookmarks();
}

function renderBookmarks() {
    const list = document.getElementById('bookmarks-list');
    list.innerHTML = '';
    if (AppState.bookmarks.length === 0) return list.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center;">No bookmarks saved yet.</p>`;

    AppState.bookmarks.sort((a, b) => a.surah - b.surah || parseInt(a.verse) - parseInt(b.verse));
    AppState.bookmarks.forEach((bm) => {
        const li = document.createElement('li'); li.className = 'bookmark-item';
        li.innerHTML = `<div class="bookmark-info"><span class="bookmark-title">Surah ${bm.name}</span><span class="bookmark-snippet">Verse ${bm.verse}</span></div>
                        <button class="bookmark-delete" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>`;
        li.querySelector('.bookmark-info').onclick = () => openSurah(bm.surah, bm.verse);
        li.querySelector('.bookmark-delete').onclick = (e) => { e.stopPropagation(); toggleBookmark(bm.surah, bm.verse, bm.name, null); };
        list.appendChild(li);
    });
}

// ==========================================
// 10. EVENT LISTENERS & SCRUBBING
// ==========================================
document.getElementById('open-settings-btn').onclick = () => { history.pushState({ view: 'settings' }, '', '#settings'); displaySettings(); };
document.getElementById('close-settings-btn').onclick = () => { history.pushState({ view: 'home' }, '', window.location.pathname); displayHome(); };
document.getElementById('prev-surah-btn').onclick = () => openSurah(AppState.currentSurahIndex - 1);
document.getElementById('home-btn').onclick = () => { history.pushState({ view: 'home' }, '', ' '); displayHome(); };
document.getElementById('next-surah-btn').onclick = () => openSurah(AppState.currentSurahIndex + 1);

document.addEventListener('keydown', (e) => {
    if (document.getElementById('surah-view').classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { getActiveFeed().scrollBy({ top: window.innerHeight, behavior: 'smooth' }); }
    if (e.key === 'ArrowUp') { haltAllAutomations(); getActiveFeed().scrollBy({ top: -window.innerHeight, behavior: 'smooth' }); }
    if (e.key === 'ArrowRight' && AppState.currentTab === 'trans') switchTabTo('arabic');
    if (e.key === 'ArrowLeft' && AppState.currentTab === 'arabic') switchTabTo('trans');
});

function initScrubbing() {
    const track = document.getElementById('progress-track');
    const tooltip = document.getElementById('scrubber-tooltip');
    let isScrubbing = false;

    const handleScrub = (e) => {
        if (!isScrubbing) return;
        const rect = track.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

        const maxScroll = DOM.transFeed.scrollHeight - DOM.transFeed.clientHeight;
        const targetScroll = percentage * maxScroll;

        DOM.transFeed.scrollTop = targetScroll;
        DOM.arabicFeed.scrollTop = percentage * (DOM.arabicFeed.scrollHeight - DOM.arabicFeed.clientHeight);

        const screens = Array.from(getActiveFeed().querySelectorAll('.verse-screen'));
        let closestVerse = '';

        for (let i = 0; i < screens.length; i++) {
            if (screens[i].offsetTop >= targetScroll) {
                closestVerse = screens[i].dataset.verse;
                break;
            }
        }
        if (!closestVerse && screens.length > 0) closestVerse = screens[screens.length - 1].dataset.verse;

        tooltip.innerText = closestVerse === 'bismillah' ? 'Bismillah' : `Verse ${closestVerse}`;
        tooltip.style.left = `${percentage * 100}%`;
    };

    const startScrub = (e) => {
        isScrubbing = true;
        AppState.userHasInteracted = true;
        tooltip.classList.add('visible');
        DOM.transFeed.style.scrollBehavior = 'auto';
        DOM.arabicFeed.style.scrollBehavior = 'auto';
        haltAllAutomations();
        handleScrub(e);
    };

    const stopScrub = () => {
        if (isScrubbing) {
            isScrubbing = false;
            tooltip.classList.remove('visible');
            DOM.transFeed.style.scrollBehavior = 'smooth';
            DOM.arabicFeed.style.scrollBehavior = 'smooth';
            DOM.transFeed.scrollBy(0, 0);
            DOM.arabicFeed.scrollBy(0, 0);
        }
    };

    track.addEventListener('mousedown', startScrub); window.addEventListener('mousemove', handleScrub); window.addEventListener('mouseup', stopScrub); track.addEventListener('mouseleave', stopScrub);
    track.addEventListener('touchstart', startScrub, { passive: true }); track.addEventListener('touchmove', handleScrub, { passive: true }); track.addEventListener('touchend', stopScrub);
}

const updateProgressBar = () => {
    const active = getActiveFeed();
    const pb = document.getElementById('progress-bar');
    if (active && pb) pb.style.width = `${(active.scrollTop / (active.scrollHeight - active.clientHeight || 1)) * 100}%`;
};

function showToast(message) {
    const toast = document.getElementById('toast-container');
    toast.innerText = message; toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function addLongPressListener(element, message) {
    if (!element) return;
    let timer;
    const start = () => { timer = setTimeout(() => { showToast(message); if (navigator.vibrate) navigator.vibrate(50); }, 500); };
    const cancel = () => clearTimeout(timer);
    ['touchstart', 'mousedown'].forEach(evt => element.addEventListener(evt, start, { passive: true }));
    ['touchend', 'mouseup', 'mouseleave'].forEach(evt => element.addEventListener(evt, cancel));
    element.addEventListener('contextmenu', e => e.preventDefault());
}

function initScrollingFades() {
    DOM.tabCarousel.addEventListener('scroll', () => {
        const snapPoint = window.innerWidth / 2;
        if (DOM.tabCarousel.scrollLeft > snapPoint && AppState.currentTab !== 'arabic') updateTabUI('arabic');
        else if (DOM.tabCarousel.scrollLeft <= snapPoint && AppState.currentTab !== 'trans') updateTabUI('trans');
    });

    function handleFeedScroll(feed) {
        updateProgressBar();
        feed.classList.add('is-scrolling');

        if (AppState.userHasInteracted && feed.scrollTop > 50) {
            AppState.preventSave = false;
            hideContinueBanner(false);
        }

        if (!AppState.hasSwipedUp && feed.scrollTop > 50) {
            AppState.hasSwipedUp = true;
            localStorage.setItem('quran_has_swiped', 'true');
            const hint = document.getElementById('swipe-hint');
            if (hint) { hint.classList.add('fade-out'); setTimeout(() => hint.classList.add('hidden'), 300); }
        }

        clearTimeout(feed.scrollFadeTimer);
        feed.scrollFadeTimer = setTimeout(() => feed.classList.remove('is-scrolling'), 200);
    }

    DOM.transFeed.addEventListener('scroll', () => { if (AppState.currentTab === 'trans') handleFeedScroll(DOM.transFeed); });
    DOM.arabicFeed.addEventListener('scroll', () => { if (AppState.currentTab === 'arabic') handleFeedScroll(DOM.arabicFeed); });
}

// ==========================================
// 11. SETTINGS & PREFERENCES
// ==========================================
function initSettings() {
    const fontSlider = document.getElementById('font-size-slider');
    const fontVal = document.getElementById('font-size-val');

    fontSlider.value = AppState.fontScale;
    fontVal.innerText = AppState.fontScale.toFixed(2);
    document.documentElement.style.setProperty('--font-scale', AppState.fontScale);

    fontSlider.addEventListener('input', (e) => {
        AppState.fontScale = parseFloat(e.target.value);
        fontVal.innerText = AppState.fontScale.toFixed(2);
        document.documentElement.style.setProperty('--font-scale', AppState.fontScale);
        localStorage.setItem('fontScale', AppState.fontScale);
    });

    const themeBtn = document.getElementById('theme-toggle');
    const themeMeta = document.getElementById('theme-color-meta');
    let currentTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    const applyTheme = (t) => {
        document.documentElement.setAttribute('data-theme', t);
        themeBtn.innerText = t === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
        themeMeta.setAttribute('content', t === 'dark' ? '#0f172a' : '#fcfaf7');
    };
    applyTheme(currentTheme);
    themeBtn.onclick = () => { currentTheme = currentTheme === 'dark' ? 'light' : 'dark'; localStorage.setItem('theme', currentTheme); applyTheme(currentTheme); };

    const fontSelect = document.getElementById('arabic-font-select');
    let currentArabicFont = localStorage.getItem('arabicFont') || 'default';
    fontSelect.value = currentArabicFont;
    document.documentElement.setAttribute('data-arabic-font', currentArabicFont);
    fontSelect.addEventListener('change', (e) => {
        currentArabicFont = e.target.value; localStorage.setItem('arabicFont', currentArabicFont);
        document.documentElement.setAttribute('data-arabic-font', currentArabicFont);
    });

    const transSelect = document.getElementById('translation-select');
    transSelect.value = AppState.translationFile;
    transSelect.addEventListener('change', async (e) => {
        AppState.translationFile = e.target.value; localStorage.setItem('translationFile', AppState.translationFile);
        await fetchQuranData();
    });

    const audioModeSelect = document.getElementById('audio-mode-select');
    const reciterSelect = document.getElementById('reciter-select');
    const ttsVoiceSelect = document.getElementById('tts-voice-select');

    audioModeSelect.value = AppState.audioMode;

    reciterSelect.disabled = AppState.audioMode === 'tts';
    ttsVoiceSelect.disabled = AppState.audioMode === 'mp3';

    audioModeSelect.addEventListener('change', (e) => {
        AppState.audioMode = e.target.value;
        localStorage.setItem('audioMode', AppState.audioMode);

        reciterSelect.disabled = AppState.audioMode === 'tts';
        ttsVoiceSelect.disabled = AppState.audioMode === 'mp3';

        stopAudio();
    });

    reciterSelect.value = AppState.reciterPath;
    reciterSelect.addEventListener('change', (e) => {
        AppState.reciterPath = e.target.value;
        localStorage.setItem('reciterPath', AppState.reciterPath);
        stopAudio();
    });

    ttsVoiceSelect.addEventListener('change', (e) => {
        AppState.ttsVoiceURI = e.target.value;
        localStorage.setItem('ttsVoiceURI', AppState.ttsVoiceURI);
        stopAudio();
    });

    if (typeof speechSynthesis !== 'undefined') {
        populateVoiceList();
        // Fallback for some browsers that fire this event late
        speechSynthesis.onvoiceschanged = populateVoiceList;
    }

    const speedSlider = document.getElementById('scroll-speed-slider');
    const speedValDisplay = document.getElementById('speed-val');
    speedSlider.value = AppState.autoScrollSpeed; speedValDisplay.innerText = AppState.autoScrollSpeed;
    speedSlider.addEventListener('input', (e) => {
        AppState.autoScrollSpeed = e.target.value; speedValDisplay.innerText = AppState.autoScrollSpeed;
        localStorage.setItem('autoScrollSpeed', AppState.autoScrollSpeed);
    });
}