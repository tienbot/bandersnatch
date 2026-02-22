import { useEffect, useRef, useState } from "react";
import scenes from "./data/scenes.json";
import "./App.css";

const MIME = 'video/mp4; codecs="avc1.640028, mp4a.40.2"';

// 🔧 DEV
const DEV_MODE = true;
const DEV_SCENE = "scene80";

// ⏱ за сколько секунд до конца сцены показывать выбор
const SHOW_CHOICES_BEFORE = 10;

export default function App() {
  const videoRef = useRef(null);
  const sourceBufferRef = useRef(null);
  const autoChoiceTimerRef = useRef(null);

  // ⏱ момент начала текущей сцены в глобальном таймлайне
  const sceneStartRef = useRef(0);

  const [currentScene, setCurrentScene] = useState(
    DEV_MODE ? DEV_SCENE : "start"
  );
  const [showChoices, setShowChoices] = useState(false);

  // ───────── helpers ─────────

  const fetchVideo = async (url) => {
    const res = await fetch(url);
    return await res.arrayBuffer();
  };

  const appendScene = async (sceneKey) => {
    const sb = sourceBufferRef.current;
    const video = videoRef.current;
    const scene = scenes[sceneKey];

    if (!sb || !video || !scene) return;

    // ⏱ фиксируем РЕАЛЬНЫЙ старт сцены
    const start =
      video.buffered.length > 0
        ? video.buffered.end(video.buffered.length - 1)
        : 0;

    sceneStartRef.current = start;

    console.log(
      `▶ scene "${sceneKey}" starts at ${start.toFixed(2)}`
    );

    const logRealVideoDuration = (url) => {
      const v = document.createElement("video");
      v.src = url;
      v.preload = "metadata";

      v.onloadedmetadata = () => {
        console.log("REAL duration:", v.duration);
      };
    };
    logRealVideoDuration(scenes[currentScene].video);

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
  };

  // ───────── INIT ─────────

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
      } catch {
        console.warn("Autoplay blocked");
      }
    });
  }, []);

  // ───────── ПОКАЗ ВЫБОРА ─────────

  useEffect(() => {
    const video = videoRef.current;
    const scene = scenes[currentScene];

    if (!video || !scene?.choices || !scene.duration) return;

    const onTimeUpdate = () => {
      // ⏱ ЛОКАЛЬНОЕ время сцены
      const localTime = video.currentTime - sceneStartRef.current;
      const showAt = scene.duration - SHOW_CHOICES_BEFORE;

      // console.log(
      //   currentScene,
      //   localTime.toFixed(1),
      //   "/",
      //   scene.duration
      // );

      if (localTime >= showAt && !showChoices) {
        setShowChoices(true);

        if (scene.choiceTimeout) {
          autoChoiceTimerRef.current = setTimeout(() => {
            const random =
              scene.choices[Math.floor(Math.random() * scene.choices.length)];
            choose(random);
          }, scene.choiceTimeout);
        }
      }
    };

    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [currentScene, showChoices]);

  // ───────── CHOOSE ─────────

  const choose = async (choice) => {
    if (autoChoiceTimerRef.current) {
      clearTimeout(autoChoiceTimerRef.current);
      autoChoiceTimerRef.current = null;
    }

    setShowChoices(false);

    const nextKey = choice.next;
    setCurrentScene(nextKey);

    await appendScene(nextKey);
  };

  // ───────── UI ─────────

  return (
    <div className="app">
      <video
        ref={videoRef}
        style={{ width: "100%"}}
      />

      {showChoices && scenes[currentScene]?.choices && (
        <div className="choices">
          {scenes[currentScene].choices.map((c, i) => (
            <button key={i} onClick={() => choose(c)}>
              {c.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
