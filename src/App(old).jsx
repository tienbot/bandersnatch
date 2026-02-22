import { useEffect, useRef, useState, useCallback } from "react";
import scenes from "./data/scenes.json";
import "./App.css";

const MIME = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

const DEV_MODE = true;
const DEV_SCENE = "scene26";

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

  const [currentScene, setCurrentScene] = useState(
    DEV_MODE ? DEV_SCENE : "start"
  );
  const [showChoices, setShowChoices] = useState(false);
  const [timerProgress, setTimerProgress] = useState(1);

  const [cereal, setCereal] = useState(null);             // хлопья
  const [isCalinAlife, setIsCalinAlife] = useState(true); // Колин

  const variables = { cereal, isCalinAlife };

  const [phoneInput, setPhoneInput] = useState("");
  const [codeInput, setCodeInput] = useState("");

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
  const fetchVideo = useCallback(async (url) => {
    const res = await fetch(url);
    return await res.arrayBuffer();
  }, []);

  // ───────── APPEND SCENE ─────────
  const appendScene = useCallback(async (sceneKey) => {
    const sb = sourceBufferRef.current;
    const video = videoRef.current;
    const scene = scenes[sceneKey];

    if (!sb || !video || !scene) return;

    const start =
      video.buffered.length > 0
        ? video.buffered.end(video.buffered.length - 1)
        : 0;

    sceneStartRef.current = start;

    const data = await fetchVideo(scene.video);

    if (sb.updating) {
      await new Promise((r) =>
        sb.addEventListener("updateend", r, { once: true })
      );
    }

    sb.appendBuffer(data);

    await new Promise((r) =>
      sb.addEventListener("updateend", r, { once: true })
    );
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
    }
    else if (current.condition) {
      nextKey = resolveCondition(current.condition);
    }
    else if (choice?.next) {
      nextKey = choice.next;
    }
    if (!nextKey) {
      console.warn("Не удалось определить следующую сцену для", currentScene, choice);
      return;
    }
    // console.log("▶ LOADING:", nextKey);

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

  // ───────── PHONE HANDLER ─────────
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

  // ───────── CODE HANDLER ─────────
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

  // ───────── INIT + PREVENT PAUSE DURING TIMER ─────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const preventPause = () => {
      if (showChoices && scenes[currentScene]?.type !== "tv") {
        video.play().catch(() => { });
      }
    };

    video.addEventListener("pause", preventPause);
    video.addEventListener("playing", () => { });

    return () => {
      video.removeEventListener("pause", preventPause);
    };
  }, [showChoices, currentScene]);

  useEffect(() => {
    const video = videoRef.current;
    const mediaSource = new MediaSource();

    video.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", async () => {
      const sb = mediaSource.addSourceBuffer(MIME);
      sb.mode = "sequence";
      sourceBufferRef.current = sb;

      const firstScene = DEV_MODE ? DEV_SCENE : "start";
      await appendScene(firstScene);

      try {
        await video.play();
      } catch {}
    });
  }, [appendScene]);

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

        // console.log("🎯 PRESELECTED:", random.text, "→", random.next || random.condition?.default || "?");

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
            // console.log("⏰ AUTO DEFAULT for input →", scene.default);
            choose({ next: scene.default });
          }
        } else if (preselectedChoiceRef.current) {
          // console.log(
          //   "⏰ AUTO USING PRESELECTED:",
          //   preselectedChoiceRef.current.text,
          //   "→",
          //   preselectedChoiceRef.current.next
          // );
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

  // ───────── UI ─────────
  const scene = scenes[currentScene];

  return (
    <div className="app">
      <video ref={videoRef} style={{ width: "100%" }} controls disablePictureInPicture/>

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
  );
}