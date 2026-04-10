export const ICONS = {
    bookmark: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    play: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`,
    autoplay: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M4 10h12v2H4zm0-4h12v2H4zm0 8h8v2H4zm10 0v6l5-3z"/></svg>`
};

export const AppState = {
    surahMeta: null,
    quranXML: null,
    arabicXML: null,
    translationFile: localStorage.getItem('translationFile') || 'en.itani.xml',
    fontScale: parseFloat(localStorage.getItem('fontScale')) || 1.0,
    audioMode: localStorage.getItem('audioMode') || 'mp3',
    reciterPath: localStorage.getItem('reciterPath') || 'Alafasy_128kbps',
    ttsVoiceURI: localStorage.getItem('ttsVoiceURI') || '',
    availableTTSVoices: [],
    bookmarks: JSON.parse(localStorage.getItem('quran_bookmarks')) || [],
    savedPositions: JSON.parse(localStorage.getItem('quran_positions')) || {},
    currentSurahIndex: 1,
    currentArabicSurahName: '',
    currentTab: 'trans',
    activeVerseIndex: null,
    verseObserver: null,
    preventSave: true,
    userHasInteracted: false,
    autoAdvanceAudio: false,
    isAutoScrolling: false,
    autoScrollSpeed: parseInt(localStorage.getItem('autoScrollSpeed')) || 400,
    autoScrollTimer: null,
    shouldAutoPlayNext: false,
    hasSwipedUp: localStorage.getItem('quran_has_swiped') === 'true',
    currentAudioObj: null,
    activePlayingVerse: null
};

export const DOM = {
    tabCarousel: document.getElementById('tab-carousel'),
    transFeed: document.getElementById('trans-feed'),
    arabicFeed: document.getElementById('arabic-feed')
};

export const getActiveFeed = () => AppState.currentTab === 'trans' ? DOM.transFeed : DOM.arabicFeed;