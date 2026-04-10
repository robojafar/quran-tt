import { AppState, DOM, ICONS, getActiveFeed } from './store.js';

export function getAudioUrl(surah, verse) {
    if (verse === 'bismillah') return `https://everyayah.com/data/${AppState.reciterPath}/001001.mp3`;
    return `https://everyayah.com/data/${AppState.reciterPath}/${String(surah).padStart(3, '0')}${String(verse).padStart(3, '0')}.mp3`;
}

export function stopAudio() {
    if (AppState.currentAudioObj) {
        AppState.currentAudioObj.pause();
        AppState.currentAudioObj.currentTime = 0;
        AppState.currentAudioObj = null;
    }
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
    }
    AppState.activePlayingVerse = null;
    document.querySelectorAll('.play-btn.playing').forEach(btn => {
        btn.innerHTML = ICONS.play;
        btn.classList.remove('playing');
    });
}

export function playAudio(surah, verse) {
    if (AppState.activePlayingVerse === verse) return stopAudio();
    stopAudio();
    AppState.activePlayingVerse = verse;

    if (AppState.isAutoScrolling) {
        AppState.isAutoScrolling = false;
        clearTimeout(AppState.autoScrollTimer);
        document.getElementById('header-autoscroll-btn').classList.remove('active');
    }

    const targets = document.querySelectorAll(`[data-verse="${verse}"]`);
    targets.forEach(screen => {
        const btn = screen.querySelector('.play-btn');
        if (btn) { btn.innerHTML = ICONS.pause; btn.classList.add('playing'); }
    });

    const triggerNext = () => {
        setTimeout(() => {
            stopAudio();
            if (AppState.autoAdvanceAudio) {
                AppState.shouldAutoPlayNext = true;
                getActiveFeed().scrollBy({ top: window.innerHeight, behavior: 'smooth' });
            }
        }, 300);
    };

    if (AppState.audioMode === 'tts') {
        const verseScreen = DOM.transFeed.querySelector(`[data-verse="${verse}"]`);
        const textToRead = verseScreen ? verseScreen.querySelector('.verse-text').innerText : "";
        const utterance = new SpeechSynthesisUtterance(textToRead);

        if (AppState.availableTTSVoices.length > 0) {
            const selectedVoice = AppState.availableTTSVoices.find(v => v.voiceURI === AppState.ttsVoiceURI);
            utterance.voice = selectedVoice || null;
        } else {
            utterance.lang = 'en-US';
        }
        utterance.rate = 0.95;
        utterance.onend = triggerNext;
        window.speechSynthesis.speak(utterance);
    } else {
        AppState.currentAudioObj = new Audio(getAudioUrl(surah, verse));
        AppState.currentAudioObj.play();
        AppState.currentAudioObj.onended = triggerNext;
    }
}

export function toggleAutoPlay(forceState = null, silent = false, showToastCb) {
    AppState.autoAdvanceAudio = forceState !== null ? forceState : !AppState.autoAdvanceAudio;
    document.querySelectorAll('.autoplay-toggle').forEach(btn => btn.classList.toggle('active', AppState.autoAdvanceAudio));

    if (AppState.autoAdvanceAudio) {
        if (AppState.isAutoScrolling) {
            AppState.isAutoScrolling = false;
            document.getElementById('header-autoscroll-btn').classList.remove('active');
            clearTimeout(AppState.autoScrollTimer);
        }
        if (!silent && showToastCb) showToastCb("Auto-Advance Audio Enabled");
    } else {
        if (!silent && showToastCb) showToastCb("Auto-Advance Audio Disabled");
        AppState.shouldAutoPlayNext = false;
    }
}

export function populateVoiceList() {
    AppState.availableTTSVoices = window.speechSynthesis.getVoices();
    const voiceSelect = document.getElementById('tts-voice-select');
    const englishVoices = AppState.availableTTSVoices.filter(voice => voice.lang.startsWith('en'));
    const voicesToUse = englishVoices.length > 0 ? englishVoices : AppState.availableTTSVoices;

    if (voicesToUse.length === 0) {
        voiceSelect.innerHTML = '<option value="">No voices available</option>';
        return;
    }

    voiceSelect.innerHTML = '';
    voicesToUse.forEach((voice) => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' -- Default' : ''}`;
        option.setAttribute('value', voice.voiceURI);
        voiceSelect.appendChild(option);
    });

    if (AppState.ttsVoiceURI && voicesToUse.find(v => v.voiceURI === AppState.ttsVoiceURI)) {
        voiceSelect.value = AppState.ttsVoiceURI;
    } else {
        AppState.ttsVoiceURI = voicesToUse[0].voiceURI;
        voiceSelect.value = AppState.ttsVoiceURI;
    }
}