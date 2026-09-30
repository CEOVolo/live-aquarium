# Проба картинки в Unreal Engine 5

## Зачем

Заказчику принципиальны реалистичность и качество картинки. Браузерный рендер (WebGL) в фотореализм не упирается даже с хорошими моделями: нет настоящего глобального освещения и объёмного света в воде. Поэтому картинку переносим в UE5, а весь «мозг» (чат, AI, антиспам, режиссёр, мир — `server/`) остаётся как есть и подключается к Unreal по уже описанному протоколу ([ARCHITECTURE.md](ARCHITECTURE.md)).

Сначала — **проба картинки**: небольшой уголок рифа, по которому заказчик скажет «да, вот так». Только после одобрения — подключение к режиссёру и остальное.

## Ограничения

- Ноутбук Windows, **NVIDIA GeForce RTX 4060 Laptop, 8 ГБ**. Цель — 1080p. Lumen (программный или аппаратный), Nanite для фотосканов. 8 ГБ видеопамяти — главное ограничение: следить за пулом стриминга текстур (`r.Streaming.PoolSize`), разрешением текстур сканов (2K–4K, не 8K).
- **Бюджета на ассеты нет**: только бесплатное (CC0 / CC BY / бесплатное на Fab). У пользователя есть подписка **Meshy** — можно генерировать недостающих рыб.
- Для круглосуточного стрима ноутбук не идеален (нагрев, надёжность) — это решаем после одобрения картинки.

## Подготовка ноутбука

1. Git for Windows (в него входит Git LFS), Node.js 20.6+.
2. Epic Games Launcher → Unreal Engine 5 (последняя 5.x). Около 100 ГБ свободного места с учётом ассетов.
3. Blender 5.x — по желанию, для доводки моделей (`scripts/models/prepare.py` работает и там).
4. Клонировать репозиторий, выполнить `git lfs install`, `npm install`, `npm test` — всё должно быть зелёным.
5. Проект Unreal — `unreal/LiveAquarium/` (без C++). **В git только скрипты и конфиги**: `Content/` и скачанные ассеты в `.gitignore` (1,2 ГБ + 0,7 ГБ не влезают в бесплатный Git LFS), сцена целиком пересобирается скриптами.

Сцену собирать **Python-скриптами редактора** (`unreal` module) в `unreal/scripts/`: импорт ассетов, расстановка, материалы, свет, камеры. Так сцену можно пересобрать и менять кодом, а не только руками в редакторе.

### Как пересобрать сцену с нуля

Скрипты выполняются в **открытом** редакторе через Python Remote Execution (включено в `Config/DefaultEngine.ini`); окно проекта не закрывать, свернуть можно. `$py` — Python движка: `D:\UE\UE_5.8\Engine\Binaries\ThirdParty\Python3\Win64\python.exe`.

1. Ассеты: `scripts/assets/fetch_polyhaven.ps1` (CC0, без входа); сканы Sketchfab — только из залогиненного браузера: скрипт на странице sketchfab.com собирает временные ссылки в `lt_sketchfab_links.json` («Загрузки»), затем `scripts/assets/fetch_sketchfab.ps1` (ссылки живут минуты). Модели и авторы — в `assets/models/CREDITS.md`.
2. Открыть `unreal/LiveAquarium/LiveAquarium.uproject`.
3. По порядку: `$py unreal/scripts/ue_remote.py import_fish.py`, затем `import_env.py`, `import_reef.py`, `build_materials.py`, `build_scene.py`.
4. Кадры: `powershell -File unreal/scripts/shots.ps1 [-Cams Cam_Wide,...]` → `unreal/LiveAquarium/Saved/Screenshots/WindowsEditor/lt_<камера>.png`.

Грабли: Python редактора держит модули между запусками (скрипты делают `importlib.reload(lt_common)`); материалы не удалять и не пересоздавать — уровень теряет ссылки (серый материал по умолчанию), `fresh_material` вычищает узлы в существующем; безымянные входы узлов (Desaturation, Clamp) из Python не подключаются; «Use Less CPU when in Background» выключено в `Config/DefaultEditorSettings.ini`, иначе редактор в фоне не рендерит кадры; `UnrealEditor.exe -ExecutePythonScript` закрывает редактор сразу после скрипта — для рендера не годится.

## Что делаем в пробе

**Сцена:** уголок карибского рифа примерно 20 × 10 м, вид как в стриме (широкий план через «стекло») плюс 2–3 крупных плана.

- Песчаное дно (текстуры CC0 + лёгкий рельеф), камни, фотосканы кораллов и губок.
- Вода: экспоненциальный туман с объёмным туманом (цвет поглощения — сине-зелёный, плотность растёт с глубиной), направленный свет «солнце» с объёмным рассеянием → лучи в воде; каустики на дне и объектах (light function или декаль с анимированной текстурой); взвесь частиц (Niagara), редкие пузыри; постобработка: мягкий bloom, лёгкое зерно, глубина резкости на крупных планах.
- Рыбы: большая белая акула (со своей анимацией плавания и укуса), стайка мелких рыб (15–30), клоуны в анемоне, 1–2 «героя» покрупнее. Золотая рыбка — как редкий гость.

**Результат для заказчика:** 6 кадров 1920×1080 и ролик 30–60 с (Movie Render Queue), включая бросок акулы с открытой пастью. Плюс замер FPS в реальном времени на ноутбуке.

## Ассеты (бесплатные)

### Риф — фотосканы живых кораллов (CC BY 4.0, указывать авторов)

Карибский риф, снят под водой — натуральные цвета. **Важно:** в текстурах подводных сканов «впечатан» синий оттенок воды — в материале его надо снять (цветокоррекция альбедо), иначе вода в движке «посинит» второй раз. Сканы тяжёлые (0,3–3,5 млн полигонов) — включать Nanite.

| Скан | Автор | Ссылка |
|---|---|---|
| Photorealistic Brain Coral | patric_ocean | https://sketchfab.com/3d-models/photorealistic-brain-coral-b474815522af41cdb609899d6e520fac |
| Great Star Coral / Montastrea cavernosa | patric_ocean | https://sketchfab.com/3d-models/great-star-coral-sctld-montastrea-cavernosa-4df3355143f8471189c8856daccaffc2 |
| Thin Leaf Lettuce Coral | patric_ocean | https://sketchfab.com/3d-models/thin-leaf-lettuce-coral-agaricia-tenufolia-bb8f65f9b13d4070b173f813b7dbe6bc |
| Elkhorn Coral / Acropora palmata | patric_ocean | https://sketchfab.com/3d-models/elkhorn-coral-acropora-palmata-ce0fdf05ab8c4a0e94015cf3798cbc45 |
| Giant Barrel Sponge | patric_ocean | https://sketchfab.com/3d-models/giant-barrel-sponge-14302a1d886d415c926476185dc64c85 |
| Stove-pipe Sponge | patric_ocean | https://sketchfab.com/3d-models/stove-pipe-sponge-aplysina-archeri-749021f080cf4ee78adb5374584e0689 |
| Underwater Coral Reef Photogrammetry | vividrealitysolutions | https://sketchfab.com/3d-models/underwater-coral-reef-photogrametry-3d-scan-ef94bf857d2a4af5b3691d19d57baaaa |
| Coral Reef Outcrop | BenMRitt | https://sketchfab.com/3d-models/coral-reef-outcrop-8bc72c9e4575470ea30d1313e48b730c |

У patric_ocean ещё есть: Pillar Coral, Boulder Star Coral, Boulder Brain Coral, Lobed Star Coral, Lettuce coral, «Sponges on ledges», «Barrel Sponges on a ledge», Scorpionfish. Дополнительно (игровые, менее реалистичные): «Soft Coral Set» (Kanna-nakajima), «Fan Coral Med» и «Tube Sponge» (Valery.Li), «Purple Sea Urchin» (Valery.Li).

Скачивание с Sketchfab требует входа в аккаунт — это делает пользователь (или через его браузер). Брать формат GLB/glTF, исходные файлы класть в `assets/models/raw/`, авторов — в `assets/models/CREDITS.md`.

### Дно и камни (CC0)

- Текстуры песка и камня: https://ambientcg.com (Ground, Rock), https://polyhaven.com/textures
- Модели камней: https://polyhaven.com/models
- Бесплатное на Fab (фильтр Free) — проверить, что есть из морского/скального.

### Рыбы

Уже в `assets/models/raw/` (CC BY, авторы в CREDITS):

- `great_white.glb` — большая белая с ригом: кости `Jaw`, губ, зубов, позвоночника, плавников; анимации `swimming`, `bite`, `circling`. В Unreal импортировать как Skeletal Mesh с анимациями — это лучше нашего шейдера. Пасть и зубы вылеплены.
- `ryukin_goldfish.glb` — золотая рыбка с ригом и анимацией (4K-текстуры).
- `clownfish.glb` — клоун без рига (анимировать шейдером, см. ниже).

Недостающие виды для карибской темы (королевская грамма, синий хромис, атлантический синий тэнг, французский ангел): бесплатных реалистичных почти нет — варианты: Meshy (image-to-3D по фото вида), CC0-сканы ffish.asia (японские виды, часть тропических), кандидаты из поиска: «Damselfish curacao», «Yellow Angelfish With Blue Stripes», «French Angelfish», «Parrot Fish Curacao» (denvr_3d, Кюрасао).

## Анимация рыб без рига

Та же формула, что в браузере (`withSwim` в `renderer/js/fish/school.js`), как World Position Offset в материале:

- `s` — положение вдоль тела от носа (0) к хвосту (1);
- боковое смещение = `A(s) · sin(phase − s · k) + bend · s²`, где `A(s) = mix(ampHead, amp, s²) · amplitude`;
- фаза растёт со скоростью `tailHz · 2π`, амплитуда и частота — от скорости рыбы; параметры видов — в `renderer/js/fish/species.js`.

Стаи — Instanced Static Mesh или Niagara (mesh renderer), фаза и скорость — в per-instance custom data.

## После одобрения картинки

1. Клиент WebSocket в Unreal (модуль WebSockets) → `ws://<сервер>:8787/ws?role=renderer`, события и мир — по протоколу из ARCHITECTURE.md.
2. Поведение рыб: портировать логику стай и охоты из `school.js` (или вести симуляцию на сервере и слать позиции — решить по нагрузке).
3. Оверлей (шкалы голосований, тосты, «CHOMP!») оставить веб-страницей поверх картинки в OBS (Browser Source).
4. Железо для 24/7: ноутбук, стационарный ПК с RTX или облачный GPU — решить отдельно.
