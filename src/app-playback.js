    function connectPluckedString(frequency, stringIndex, startTime, duration, destination) {
      const isLowString = stringIndex >= 4;
      const sampleRate = audioContext.sampleRate;
      const frameCount = Math.max(1, Math.ceil((duration + 0.04) * sampleRate));
      const delayLength = Math.max(2, Math.round(sampleRate / frequency));
      const delayLine = new Float32Array(delayLength);
      const buffer = audioContext.createBuffer(1, frameCount, sampleRate);
      const output = buffer.getChannelData(0);
      const damping = isLowString ? 0.9972 : 0.9958;
      for (let i = 0; i < delayLength; i++) {
        const pickPosition = i / delayLength;
        delayLine[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * pickPosition);
      }
      let cursor = 0;
      for (let i = 0; i < frameCount; i++) {
        const next = (cursor + 1) % delayLength;
        const sample = delayLine[cursor];
        output[i] = sample * 0.82;
        delayLine[cursor] = damping * 0.5 * (sample + delayLine[next]);
        cursor = next;
      }
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start(startTime);
      source.stop(startTime + duration + 0.04);
      return source;
    }

    function addPickNoise(startTime, destination) {
      const sampleRate = audioContext.sampleRate;
      const length = Math.max(1, Math.floor(sampleRate * 0.018));
      const buffer = audioContext.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const ratio = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - ratio, 2.6);
      }
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      const highpass = audioContext.createBiquadFilter();
      source.buffer = buffer;
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(900, startTime);
      gain.gain.setValueAtTime(0.082, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.038);
      source.connect(highpass);
      highpass.connect(gain);
      gain.connect(destination);
      source.start(startTime);
      source.stop(startTime + 0.042);
      return source;
    }

    function followPlaybackLineInSheet(playbackLine) {
      const sheet = playbackLine?.closest('.sheet');
      if (!sheet || sheet.clientHeight <= 0) return;

      const sheetRect = sheet.getBoundingClientRect();
      const lineRect = playbackLine.getBoundingClientRect();
      const sheetCenter = sheetRect.top + sheet.clientHeight / 2;
      const lineCenter = lineRect.top + lineRect.height / 2;

      // Keep the opening lines where they naturally start. Once playback moves
      // below the sheet's center line, follow one rendered TAB line at a time.
      // If the user has manually scrolled past the playing line, recover it too.
      const shouldFollow = lineCenter > sheetCenter + 1 || lineRect.bottom < sheetRect.top;
      if (!shouldFollow) return;

      const lineCenterInContent = sheet.scrollTop + (lineCenter - sheetRect.top);
      const maxScrollTop = Math.max(0, sheet.scrollHeight - sheet.clientHeight);
      const nextScrollTop = clamp(lineCenterInContent - sheet.clientHeight / 2, 0, maxScrollTop);
      sheet.scrollTo({ top: nextScrollTop, behavior: 'smooth' });
    }

    function playCurrentSlot(row, position) {
      const activeInput = getInput(row, 0, position) || document.querySelector(`.note-input[data-row="${row}"][data-position="${position}"]`);
      const playbackLine = activeInput?.closest('.tab-grid') || activeInput?.closest('.tab-system');
      const centerKey = playbackLine?.dataset.row !== undefined ? `row-${playbackLine.dataset.row}` : playbackLine?.closest('.tab-system')?.dataset.centerKey || `row-${row}`;

      if (playbackLine && centerKey !== lastCenteredPlaybackRow) {
        // Let the follow helper decide whether movement is needed even on the
        // first playback line. Starting from the top stays put naturally, while
        // starting from a later progress position follows that line immediately.
        followPlaybackLineInSheet(playbackLine);
        lastCenteredPlaybackRow = centerKey;
      }

      getFilledInputsAt(row, position).forEach(input => {
        const stringIndex = Number(input.dataset.string);
        if (!/^x$/i.test(input.value)) playGuitarNote(stringIndex, input.value);
      });
      setProgressIndex(slotToIndex(row, position), true, true);
    }

    async function startPlayback() {
      const ready = await ensureAudioReady();
      if (!ready) return;
      stopPlayback(false);
      isPlaying = true;
      playButton.textContent = '停止';
      playButton.classList.add('is-playing');
      playButton.setAttribute('aria-label', '停止播放 TAB 譜');
      playIndex = clamp(Number(playProgress.value) || 0, 0, totalSlots() - 1);
      lastCenteredPlaybackRow = -1;
      if (playIndex === 0) {
        const sheet = editorView?.querySelector('.sheet');
        if (sheet) sheet.scrollTop = 0;
      }
      const firstPlayIndex = playIndex;
      const slotDurationMs = getSlotDurationMs();
      const playbackStartedAt = performance.now();
      const tick = () => {
        if (!isPlaying) return;
        const { row, position } = indexToSlot(playIndex);
        playCurrentSlot(row, position);
        if (playIndex >= totalSlots() - 1) {
          playbackTimer = window.setTimeout(() => stopPlayback(true, false), 60000 / getTempo());
          return;
        }
        playIndex += 1;
        const elapsedSlots = playIndex - firstPlayIndex;
        const nextSlotAt = playbackStartedAt + elapsedSlots * slotDurationMs;
        playbackTimer = window.setTimeout(tick, Math.max(0, nextSlotAt - performance.now()));
      };
      tick();
    }

    function stopPlayback(resetButton = true, stopVoices = true) {
      if (playbackTimer) {
        clearTimeout(playbackTimer);
        playbackTimer = null;
      }
      isPlaying = false;
      lastCenteredPlaybackRow = -1;
      clearPlayhead();
      if (stopVoices) stopAllStringVoices();
      if (resetButton) {
        playButton.textContent = '播放';
        playButton.classList.remove('is-playing');
        playButton.setAttribute('aria-label', '播放 TAB 譜');
      }
    }
