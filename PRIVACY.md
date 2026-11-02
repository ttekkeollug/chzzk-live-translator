개인정보처리방침 / プライバシーポリシー / Privacy Policy

치지직 실시간 번역 자막 (CHZZK Live Translated Subtitles) 시행일 / 施行日 / Effective date: 2026-11-01

한국어 · 日本語 · English

한국어
1. 기본 원칙

이 확장 프로그램(이하 "확장")은 개발자가 운영하는 서버가 없으며, 개발자는 사용자의 개인정보나 이용 기록을 수집·저장·판매·공유하지 않습니다. 확장은 광고, 분석 도구, 추적 코드를 포함하지 않습니다.

2. 확장이 다루는 정보와 처리 위치
정보	용도	처리·전송 위치
치지직 방송의 소리	한국어 음성 인식	① 크롬 내장 음성 인식을 쓰는 경우 Google 음성 인식 서비스로 전송되어 처리됩니다. ② 브라우저 Whisper를 쓰는 경우 사용자의 기기 안에서만 처리되며 외부로 전송되지 않습니다. ③ 사용자가 직접 Groq·OpenAI API 키를 입력하고 해당 엔진을 고른 경우에만 그 서비스로 전송됩니다.
인식된 문장(텍스트)	일본어·영어 번역	① 크롬 내장 번역은 기기 안에서 처리됩니다. ② 내장 번역을 쓸 수 없을 때 Google 번역(translate.googleapis.com)으로 전송됩니다. ③ AI 번역을 고른 경우 사용자가 입력한 API 키의 서비스(Groq·OpenAI)로 전송됩니다.
설정값(자막 크기, 표시 언어, 엔진 선택 등)	설정 유지	크롬 저장소(chrome.storage)에 저장되며, 크롬 동기화를 켠 경우 사용자의 Google 계정으로 동기화될 수 있습니다.
API 키(선택 입력)	사용자가 고른 외부 엔진 호출	사용자의 컴퓨터 크롬 로컬 저장소에만 저장되며 개발자에게 전송되지 않습니다.
자막 위치	위치 기억	사용자의 컴퓨터 크롬 로컬 저장소에만 저장됩니다.

브라우저 Whisper 모델은 처음 사용할 때 Hugging Face(huggingface.co)에서 내려받습니다. 이때 사용자의 방송 소리나 텍스트는 전송되지 않습니다.

방송 소리와 인식된 문장은 자막 표시를 위해 실시간으로만 사용되며, 확장은 이를 파일이나 저장소에 보관하지 않습니다. 외부 서비스로 전송된 정보는 각 서비스의 개인정보처리방침에 따라 처리됩니다(Google: https://policies.google.com/privacy , Groq: https://groq.com/privacy-policy/ , OpenAI: https://openai.com/policies/privacy-policy/).

3. 수집하지 않는 정보

이름, 이메일, 치지직·네이버 계정 정보, 채팅 내용, 방문 기록, 위치 정보 등은 수집하거나 읽지 않습니다. 확장은 chzzk.naver.com 페이지에서만 동작합니다.

4. 권한 사용 목적
tabCapture, offscreen: 사용자가 번역을 시작한 치지직 탭의 소리를 받아 음성 인식에 사용
activeTab, scripting: 번역을 시작한 치지직 탭에 자막 화면을 표시
storage: 설정, 자막 위치, (선택) API 키 저장
호스트 권한: chzzk.naver.com(자막 표시), translate.googleapis.com(번역), huggingface.co(음성 인식 모델 다운로드), api.groq.com·api.openai.com(사용자가 키를 입력한 경우에만 사용)
5. 정보 삭제

확장을 삭제하면 확장이 저장한 설정과 API 키가 모두 삭제됩니다. 팝업에서 API 키 칸을 비워 저장하면 키만 삭제할 수도 있습니다.

6. 아동의 개인정보

확장은 아동을 포함한 누구의 개인정보도 수집하지 않습니다.

7. 방침의 변경

이 방침이 바뀌면 이 페이지에 변경 내용과 시행일을 게시합니다.

8. 문의

https://github.com/ttekkeollug/chzzk-live-translator/issues

日本語
1. 基本方針

本拡張機能（以下「本拡張」）には開発者が運営するサーバーがなく、開発者はユーザーの個人情報や利用履歴を収集・保存・販売・共有しません。 広告、解析ツール、トラッキングコードは含まれていません。

2. 本拡張が扱う情報と処理先
情報	用途	処理・送信先
CHZZK配信の音声	韓国語の音声認識	① Chrome内蔵音声認識を使う場合、Googleの音声認識サービスに送信され処理されます。② ブラウザ内Whisperを使う場合、端末内でのみ処理され外部に送信されません。③ ユーザー自身がGroq・OpenAIのAPIキーを入力し、そのエンジンを選んだ場合のみ当該サービスに送信されます。
認識された文（テキスト）	日本語・英語への翻訳	① Chrome内蔵翻訳は端末内で処理されます。② 内蔵翻訳が使えない場合、Google翻訳（translate.googleapis.com）に送信されます。③ AI翻訳を選んだ場合、ユーザーが入力したAPIキーのサービス（Groq・OpenAI）に送信されます。
設定値（字幕サイズ、表示言語、エンジン選択など）	設定の保持	Chromeのストレージ（chrome.storage）に保存され、Chrome同期を有効にしている場合はユーザーのGoogleアカウントで同期されることがあります。
APIキー（任意入力）	ユーザーが選んだ外部エンジンの呼び出し	ユーザーのPCのChromeローカルストレージにのみ保存され、開発者には送信されません。
字幕の位置	位置の記憶	ユーザーのPCのChromeローカルストレージにのみ保存されます。

ブラウザ内Whisperのモデルは初回利用時にHugging Face（huggingface.co）からダウンロードされます。この際、配信の音声やテキストは送信されません。

配信の音声と認識された文は字幕表示のためにリアルタイムでのみ使用され、本拡張がファイルやストレージに保存することはありません。外部サービスに送信された情報は、各サービスのプライバシーポリシーに従って処理されます（Google: https://policies.google.com/privacy , Groq: https://groq.com/privacy-policy/ , OpenAI: https://openai.com/policies/privacy-policy/）。

3. 収集しない情報

氏名、メールアドレス、CHZZK・NAVERのアカウント情報、チャット内容、閲覧履歴、位置情報などは収集・読み取りしません。本拡張は chzzk.naver.com のページでのみ動作します。

4. 権限の利用目的
tabCapture、offscreen：ユーザーが翻訳を開始したCHZZKタブの音声を取得し、音声認識に使用
activeTab、scripting：翻訳を開始したCHZZKタブに字幕を表示
storage：設定、字幕位置、（任意）APIキーの保存
ホスト権限：chzzk.naver.com（字幕表示）、translate.googleapis.com（翻訳）、huggingface.co（音声認識モデルのダウンロード）、api.groq.com・api.openai.com（ユーザーがキーを入力した場合のみ使用）
5. 情報の削除

本拡張を削除すると、保存された設定とAPIキーはすべて削除されます。ポップアップでAPIキー欄を空にして保存すると、キーのみ削除することもできます。

6. 子どもの個人情報

本拡張は子どもを含め、誰の個人情報も収集しません。

7. 本ポリシーの変更

本ポリシーを変更する場合は、このページに変更内容と施行日を掲載します。

8. お問い合わせ

https://github.com/ttekkeollug/chzzk-live-translator/issues

English
1. Overview

This extension (the "Extension") has no developer-operated servers. The developer does not collect, store, sell, or share any personal information or usage data. The Extension contains no ads, analytics, or tracking code.

2. Information the Extension handles and where it is processed
Information	Purpose	Where it is processed / sent
Audio of the CHZZK stream	Korean speech recognition	(1) When Chrome's built-in speech recognition is used, audio is sent to and processed by Google's speech recognition service. (2) When in-browser Whisper is used, audio is processed only on your device and is not sent anywhere. (3) Sent to Groq or OpenAI only if you enter your own API key and choose that engine.
Recognized sentences (text)	Translation into Japanese and English	(1) Chrome's built-in translator processes text on your device. (2) If it is unavailable, text is sent to Google Translate (translate.googleapis.com). (3) If you choose AI translation, text is sent to the service of the API key you entered (Groq or OpenAI).
Settings (subtitle size, languages, engine choice, etc.)	Remembering your settings	Stored in Chrome storage (chrome.storage); if Chrome Sync is on, it may sync through your Google account.
API key (optional)	Calling the external engine you chose	Stored only in Chrome's local storage on your computer and never sent to the developer.
Subtitle position	Remembering the position	Stored only in Chrome's local storage on your computer.

The in-browser Whisper model is downloaded from Hugging Face (huggingface.co) on first use. No stream audio or text is sent during this download.

Stream audio and recognized sentences are used only in real time to display subtitles; the Extension does not save them to files or storage. Information sent to external services is handled under each service's privacy policy (Google: https://policies.google.com/privacy , Groq: https://groq.com/privacy-policy/ , OpenAI: https://openai.com/policies/privacy-policy/).

3. Information not collected

The Extension does not collect or read your name, email, CHZZK/NAVER account information, chat messages, browsing history, or location. It runs only on chzzk.naver.com pages.

4. Why each permission is used
tabCapture, offscreen: capture the audio of the CHZZK tab where you started translation, for speech recognition
activeTab, scripting: show subtitles on the CHZZK tab where you started translation
storage: save settings, subtitle position, and the optional API key
Host permissions: chzzk.naver.com (showing subtitles), translate.googleapis.com (translation), huggingface.co (downloading the speech model), api.groq.com and api.openai.com (used only if you enter a key)
5. Deleting your information

Uninstalling the Extension removes all of its saved settings and API keys. You can also delete just the API key by clearing the field in the popup.

6. Children's privacy

The Extension does not collect personal information from anyone, including children.

7. Changes to this policy

Any changes will be posted on this page with a new effective date.

8. Contact

https://github.com/ttekkeollug/chzzk-live-translator/issues
