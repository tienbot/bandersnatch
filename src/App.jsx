import { useEffect, useRef, useState, useCallback } from "react";
import scenes from "./data/scenes.json";
import "./App.css";

const R2_BASE_URL = "https://pub-cf1bdec7b23a49059fef914848e3b507.r2.dev/";
const MIME = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

const DEV_MODE = false;
const DEV_SCENE = "scene74";

const SHOW_CHOICES_BEFORE = 10;
const TV_SHOW_BEFORE = 30;

export default function App() {
  const videoRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const sceneStartRef = useRef(0);
  const choiceStartedRef = useRef(false);
  const timerLineRef = useRef(null);
  const animationFrameRef = useRef(null);

  const preselectedChoiceRef = useRef(null);
  const autoTriggeredRef = useRef(false);

  const [currentScene, setCurrentScene] = useState("start");
  const [showChoices, setShowChoices] = useState(false);
  const [timerProgress, setTimerProgress] = useState(1);

  const [cereal, setCereal] = useState(null);
  const [isCalinAlife, setIsCalinAlife] = useState(true);

  const variables = { cereal, isCalinAlife };

  const [phoneInput, setPhoneInput] = useState("");
  const [codeInput, setCodeInput] = useState("");

  // Модалка-дисклеймер (показывается только при первом запуске)
  const [showDisclaimer, setShowDisclaimer] = useState(true);

  // ───────── CONDITION RESOLVER ─────────
  const resolveCondition = useCallback((condition) => {
    if (!condition) return null;

    for (const c of condition.cases) {
      const matches = Object.entries(c.when).every(
        ([key, value]) => variables[key] === value
      );
      if (matches) return c.next;
    }

    return condition.default || null;
  }, [variables]);

  // ───────── FETCH VIDEO ─────────
  const fetchVideo = useCallback(async (sceneKey) => {
    const scene = scenes[sceneKey];
    if (!scene) {
      throw new Error(`Сцена не найдена: ${sceneKey}`);
    }
    if (!scene.video) {
      throw new Error(`Нет поля video в сцене ${sceneKey}`);
    }

    const relative = scene.video.replace(/^\//, "");
    const fullUrl = `${R2_BASE_URL}${relative}`;

    const res = await fetch(fullUrl);
    if (!res.ok) {
      throw new Error(`Не удалось загрузить видео: ${res.status} ${fullUrl}`);
    }

    return await res.arrayBuffer();
  }, []);

  // ───────── APPEND SCENE ─────────
  const appendScene = useCallback(async (sceneKey) => {
    const sb = sourceBufferRef.current;
    const video = videoRef.current;
    if (!sb || !video) return;

    const scene = scenes[sceneKey];
    if (!scene) return;

    const start =
      video.buffered.length > 0
        ? video.buffered.end(video.buffered.length - 1)
        : 0;

    sceneStartRef.current = start;

    const data = await fetchVideo(sceneKey);

    if (sb.updating) {
      await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
    }

    sb.appendBuffer(data);

    await new Promise((r) => sb.addEventListener("updateend", r, { once: true }));
  }, [fetchVideo]);

  // ───────── CHOOSE ─────────
  const choose = useCallback(async (choice) => {
    const video = videoRef.current;
    if (!video) return;

    const current = scenes[currentScene];
    if (!current) return;

    setShowChoices(false);
    setTimerProgress(1);
    setPhoneInput("");
    setCodeInput("");
    choiceStartedRef.current = false;
    preselectedChoiceRef.current = null;
    autoTriggeredRef.current = true;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    let nextKey = null;

    if (choice?.condition) {
      nextKey = resolveCondition(choice.condition);
    } else if (choice?.next) {
      nextKey = choice.next;
    } else if (current.condition) {
      nextKey = resolveCondition(current.condition);
    }

    if (!nextKey) return;

    const isCurrentTV = current.type === "tv";

    if (isCurrentTV) {
      const start =
        video.buffered.length > 0
          ? video.buffered.end(video.buffered.length - 1)
          : 0;

      sceneStartRef.current = start;

      await appendScene(nextKey);

      video.currentTime = sceneStartRef.current;

      try {
        await video.play();
      } catch {}
    } else {
      await appendScene(nextKey);
    }

    setCurrentScene(nextKey);
  }, [appendScene, resolveCondition, currentScene]);

  // ───────── PHONE & CODE HANDLERS ─────────
  const handlePhoneChange = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 5);
    const formatted = digits.split("").join("-");
    setPhoneInput(formatted);

    if (digits.length === 5) {
      const scene = scenes[currentScene];
      if (!scene) return;

      const correctChoice = scene.choices.find((c) => c.text === "20541");
      const wrongChoice = scene.choices.find((c) => c.text !== "20541");

      if (digits === "20541") {
        choose(correctChoice);
      } else {
        choose(wrongChoice);
      }
    }
  };

  const handleCodeChange = (e) => {
    const raw = e.target.value.replace(/\s/g, "").slice(0, 3).toUpperCase();
    const formatted = raw.split("").join(" ");
    setCodeInput(formatted);

    if (raw.length === 3) {
      const scene = scenes[currentScene];
      if (!scene) return;

      const match = scene.choices.find(
        (choice) => choice.text.toUpperCase() === raw
      );

      if (match) {
        choose(match);
      } else {
        const fallback = Math.random() > 0.5 ? "scene69" : "scene64";
        choose({ next: fallback });
      }
    }
  };

  // ───────── PREVENT PAUSE DURING TIMER ─────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const preventPause = () => {
      if (showChoices && scenes[currentScene]?.type !== "tv") {
        video.play().catch(() => {});
      }
    };

    video.addEventListener("pause", preventPause);
    return () => video.removeEventListener("pause", preventPause);
  }, [showChoices, currentScene]);

  // ───────── INIT MEDIA SOURCE (запускается только после закрытия модалки) ─────────
  useEffect(() => {
    // Не запускаем плеер, пока модалка видна
    if (showDisclaimer) return;

    const video = videoRef.current;
    if (!video) return;

    const mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", async () => {
      try {
        const sb = mediaSource.addSourceBuffer(MIME);
        sb.mode = "sequence";
        sourceBufferRef.current = sb;

        const firstScene = DEV_MODE ? DEV_SCENE : "start";
        await appendScene(firstScene);

        // Пытаемся запустить видео сразу после загрузки первой сцены
        await video.play().catch((err) => {
          console.warn("Автозапуск заблокирован:", err);
        });
      } catch (err) {
        console.error("Ошибка инициализации MediaSource:", err);
      }
    });

    return () => {
      if (mediaSource.readyState === "open") {
        mediaSource.endOfStream();
      }
    };
  }, [showDisclaimer, appendScene]);

  // ───────── UPDATE VARIABLES ─────────
  useEffect(() => {
    const scene = scenes[currentScene];
    if (!scene) return;

    if (scene.cereal !== undefined) setCereal(scene.cereal);
    if (scene.isCalinAlife !== undefined) setIsCalinAlife(scene.isCalinAlife);
  }, [currentScene]);

  // ───────── SHOW CHOICES + PRESELECT ─────────
  useEffect(() => {
    const video = videoRef.current;
    const scene = scenes[currentScene];

    if (!video || !scene?.choices || !scene.duration) return;

    choiceStartedRef.current = false;
    autoTriggeredRef.current = false;
    setShowChoices(false);
    setTimerProgress(1);
    preselectedChoiceRef.current = null;

    const showBefore = scene.type === "tv" ? TV_SHOW_BEFORE : SHOW_CHOICES_BEFORE;

    const onTimeUpdate = () => {
      const localTime = video.currentTime - sceneStartRef.current;
      const showAt = scene.duration - showBefore;

      if (localTime >= showAt && !choiceStartedRef.current) {
        choiceStartedRef.current = true;

        if (scene.type === "phone" || scene.type === "code") {
          setShowChoices(true);
          return;
        }

        const random = scene.choices[Math.floor(Math.random() * scene.choices.length)];
        preselectedChoiceRef.current = random;
        setShowChoices(true);
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [currentScene]);

  // ───────── TIMER + AUTO SWITCH ─────────
  useEffect(() => {
    const scene = scenes[currentScene];
    if (!showChoices || scene?.type === "tv") return;

    const video = videoRef.current;
    if (!video || !scene) return;

    const showAt = scene.duration - SHOW_CHOICES_BEFORE;

    const animateTimer = () => {
      const localTime = video.currentTime - sceneStartRef.current;
      const timeIntoChoice = localTime - showAt;

      const progress = Math.max(1 - timeIntoChoice / SHOW_CHOICES_BEFORE, 0);
      setTimerProgress(progress);

      if (timerLineRef.current) {
        timerLineRef.current.style.transform = `scaleX(${progress})`;
      }

      if (!autoTriggeredRef.current && localTime >= scene.duration - 0.2) {
        autoTriggeredRef.current = true;

        if (scene.type === "phone" || scene.type === "code") {
          if (scene.default) {
            choose({ next: scene.default });
          }
        } else if (preselectedChoiceRef.current) {
          choose(preselectedChoiceRef.current);
        }
        return;
      }

      animationFrameRef.current = requestAnimationFrame(animateTimer);
    };

    animationFrameRef.current = requestAnimationFrame(animateTimer);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [showChoices, currentScene, choose]);

  // ───────── HANDLE DISCLAIMER ─────────
  const handleStart = () => {
    setShowDisclaimer(false);
  };

  // ───────── UI ─────────
  const scene = scenes[currentScene];

  return (
    <>
      {showDisclaimer ? (
        <div className="disclaimer-modal">
          <div className="disclaimer-content">
            <h2>Добро пожаловать в Bandersnatch</h2>

            <p style={{ marginBottom: "1.5rem", lineHeight: "1.6" }}>
              Данный проект представляет собой любительскую интерактивную реконструкцию эпизода «Bandersnatch» из сериала «Чёрное зеркало».
            </p>

            <p style={{ marginBottom: "1rem", fontWeight: "bold" }}>
              Для наилучшего погружения рекомендуется развернуть окно браузера на полный экран:
            </p>

            <ul 
              style={{ 
                textAlign: "center", 
                margin: "0.8rem auto 1.8rem", 
                paddingLeft: "0", 
                listStylePosition: "inside", 
                maxWidth: "400px" 
              }}
            >
              <li>Windows — клавиша <strong>F11</strong></li>
              <li>macOS — сочетание <strong>Cmd + Shift + F</strong></li>
            </ul>

            <p style={{ marginBottom: "1rem" }}>
              Вам будет отведено 10 секунд на принятие решения за персонажа.  
              Выбор нельзя отменить или остановить. По истечении времени решение будет принято автоматически.
            </p>

            <p style={{ marginBottom: "2rem" }}>
              В эпизоде существует несколько концовок.  
              <strong>Главная цель</strong> — помочь главному герою создать лучшую игру.
            </p>

            <button onClick={handleStart} className="start-button">
              Начать
            </button>
          </div>
        </div>
      ) : (
        <div className="app">
          <video ref={videoRef} style={{ width: "100%" }} controls disablePictureInPicture />

          {showChoices && scene?.choices && (
            <div className="choices">
              {scene?.type !== "tv" && (
                <div className="timer">
                  <div
                    ref={timerLineRef}
                    className="timer-line"
                    style={{
                      transform: `scaleX(${timerProgress})`,
                      transition: "none",
                    }}
                  />
                </div>
              )}

              {scene?.type === "phone" ? (
                <div className="phone-input">
                  <input
                    type="text"
                    value={phoneInput}
                    onChange={handlePhoneChange}
                    placeholder="X-X-X-X-X"
                    maxLength={9}
                    autoFocus
                  />
                </div>
              ) : scene?.type === "code" ? (
                <div className="code-input">
                  <input
                    type="text"
                    value={codeInput}
                    onChange={handleCodeChange}
                    placeholder="* * *"
                    maxLength={5}
                    autoFocus
                  />
                </div>
              ) : (
                scene.choices.map((c, i) => (
                  <button key={i} onClick={() => choose(c)}>
                    {c.text}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}