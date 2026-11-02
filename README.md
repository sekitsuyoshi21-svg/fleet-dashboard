# MyGeotab 運行管理ダッシュボード

## ファイル
- `index.html`: 画面構造
- `style.css`: レスポンシブ対応のデザイン
- `app.js`: 検索、絞り込み、詳細パネル、MyGeotabライフサイクル
- `config.json`: Add-In登録用の設定例
- `icon.svg`: メニューアイコン

## ローカル確認
`index.html` をブラウザーで開くと、デモデータで操作できます。

## GitHub Pages
1. リポジトリ直下へ全ファイルをアップロードします。
2. Settings > Pages で main / root を公開します。
3. `config.json` の `YOUR_GITHUB_USERNAME` と `YOUR_EMAIL` を変更します。
4. MyGeotabの Add-Ins 設定画面へ設定JSONを登録します。

## API接続
`app.js` の `window.geotab.addin.fleetDashboard` がMyGeotab側の入口です。
現在はDevice取得の接続例とデモ表示を併用しています。実運用では Device、DeviceStatusInfo、FaultData、Diagnostic等を取得し、`vehicles` 配列へ整形してください。

## 注意
MyGeotab環境や構成スキーマのバージョンにより、config.jsonの追加プロパティが必要になる場合があります。
