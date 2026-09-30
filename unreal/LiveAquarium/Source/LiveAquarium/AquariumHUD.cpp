#include "AquariumHUD.h"

#include "AquariumFishPawn.h"
#include "AquariumGameMode.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Misc/App.h"

namespace
{
	FString FormatTime(float Seconds)
	{
		const int32 Total = FMath::FloorToInt(Seconds);
		return FString::Printf(TEXT("%d:%02d"), Total / 60, Total % 60);
	}

	const FLinearColor White(0.95f, 0.97f, 1.f);
	const FLinearColor Dim(0.75f, 0.85f, 0.9f, 0.9f);
	const FLinearColor Alarm(1.f, 0.45f, 0.2f);
	const FLinearColor Blood(1.f, 0.2f, 0.15f);
}

void AAquariumHUD::Label(const FString& Text, float X, float Y, const FLinearColor& Color, float Scale)
{
	UFont* Font = GEngine->GetMediumFont();
	DrawText(Text, FLinearColor(0.f, 0.f, 0.f, 0.6f * Color.A), X + 2.f * UiScale, Y + 2.f * UiScale, Font, Scale * UiScale);
	DrawText(Text, Color, X, Y, Font, Scale * UiScale);
}

void AAquariumHUD::LabelCentered(const FString& Text, float Y, const FLinearColor& Color, float Scale)
{
	float W = 0.f, H = 0.f;
	GetTextSize(Text, W, H, GEngine->GetMediumFont(), Scale * UiScale);
	Label(Text, (Canvas->ClipX - W) * 0.5f, Y, Color, Scale);
}

void AAquariumHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}
	UiScale = Canvas->ClipY / 1080.f;
	SmoothDeltaTime = FMath::Lerp(SmoothDeltaTime, static_cast<float>(FApp::GetDeltaTime()), 0.05f);
	const float Pad = 24.f * UiScale;

	Label(FString::Printf(TEXT("%.0f FPS   %.1f мс   %dx%d"), 1.f / FMath::Max(SmoothDeltaTime, 1e-4f),
		SmoothDeltaTime * 1000.f, FMath::RoundToInt(Canvas->ClipX), FMath::RoundToInt(Canvas->ClipY)),
		Pad, Pad, White, 1.4f);

	const AAquariumGameMode* Game = GetWorld()->GetAuthGameMode<AAquariumGameMode>();
	if (Game)
	{
		Label(FString::Printf(TEXT("Время: %s   рекорд: %s   укусов: %d"), *FormatTime(Game->SurviveTime),
			*FormatTime(Game->BestTime), Game->TimesCaught), Pad, Pad + 34.f * UiScale, Dim, 1.2f);
		if (Game->CaughtMessageTime > 0.f)
		{
			LabelCentered(TEXT("Тебя съели!"), Canvas->ClipY * 0.38f, Blood, 3.f);
		}
		else if (Game->bSharkChasing)
		{
			LabelCentered(FString::Printf(TEXT("Акула гонится!  %.0f м   Shift — рывок"), Game->SharkDistance / 100.f),
				Canvas->ClipY * 0.12f, Alarm, 1.8f);
		}
	}

	const AAquariumFishPawn* Fish = Cast<AAquariumFishPawn>(GetOwningPawn());
	if (!Fish)
	{
		return;
	}
	// запас рывка
	const float BarW = 260.f * UiScale, BarH = 10.f * UiScale;
	const float BarX = Pad, BarY = Pad + 72.f * UiScale;
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.45f), BarX, BarY, BarW, BarH);
	DrawRect(FLinearColor(0.3f, 0.85f, 1.f, 0.9f), BarX, BarY, BarW * Fish->GetBoostEnergy(), BarH);

	if (Fish->IsHelpVisible())
	{
		const float Y0 = Canvas->ClipY - Pad - 3.f * 30.f * UiScale;
		Label(TEXT("Мышь — куда плыть   W/S — вперёд/назад   A/D — вбок   Пробел/Ctrl — вверх/вниз"), Pad, Y0, Dim, 1.1f);
		Label(TEXT("Shift — рывок   колесо — ближе/дальше   V — камера стрима / за рыбой   F1 — скрыть   Esc — выход"),
			Pad, Y0 + 30.f * UiScale, Dim, 1.1f);
		Label(TEXT("Геймпад: левый стик — плыть, правый — смотреть, курки — вверх/вниз, A — рывок, Y — камера"), Pad,
			Y0 + 60.f * UiScale, Dim, 1.1f);
	}
}
