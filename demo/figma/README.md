# Figma 프로토타입용 소스

배포판(https://kucthon-26-2.vercel.app)에서 실제로 부수는 장면을 녹화했어요. 소리는 앱이 그때 재생한 효과음 파일을 시간·음높이·볼륨 그대로 다시 합쳐 넣었어요(Freesound 소리, `web/public/sounds`). 해상도는 Figma 프레임과 같은 1배(402×874)예요.

## videos/ — 부수는 영상 (MP4, 소리 포함)
| 파일 | 내용 | 길이 |
|---|---|---|
| `laptop-hammer` | 노트북을 망치로 다섯 번 → 깨짐 | 9.5초 |
| `book-press` | 책을 유압프레스로 눌러 터뜨림 | 5.9초 |
| `can-bomb` | 캔 옆에 폭탄 → 폭발 | 5.9초 |
| `book-bat` | 책을 배트로 좌우 풀스윙 | 7.1초 |
| `laptop-laser` | 노트북을 레이저로 두 번 그어 자름 | 8.1초 |

- `*-frame.mp4`: 사진 영역만 잘라낸 것 → **부수기 프레임의 Rectangle 2**에 넣기 (Fill 모드)
- `*.mp4`: 휴대폰 화면 전체 → 별도 프레임에 통째로 넣을 때

Figma에서: Rectangle 2 선택 → Fill → 이미지 대신 영상 파일 드래그 → 프로토타입 패널에서 재생 방식 지정(자동 재생/반복 등).

## photos/ — 내 모음·네트워크 카드용 원본 사진
`laptop`, `can`, `book`, `mouse`, `mug` (.jpg)

## tiles/ — 업적 칸용 정사각형 사진
`laptop`, `can`, `book`, `mouse`, `mug` (.png). 앱에서는 노트북 001, 캔 006, 마우스 012, 책 017번 칸이에요.

## screens/ — 앱 화면 캡처 (2배 해상도, 804×1748)
`collection`(내 모음), `network`(네트워크), `achievements`(업적, 네 개 해금된 상태). 프레임을 새로 꾸미기 어려우면 이 이미지를 프레임 배경으로 깔아도 돼요.
