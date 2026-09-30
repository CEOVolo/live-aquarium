#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "AquariumHUD.generated.h"

// Экран игры: FPS и время кадра (главное для пробы), время выживания, укусы, запас рывка,
// предупреждение о погоне и подсказки по управлению (F1).
UCLASS()
class AAquariumHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void Label(const FString& Text, float X, float Y, const FLinearColor& Color, float Scale);
	void LabelCentered(const FString& Text, float Y, const FLinearColor& Color, float Scale);

	float SmoothDeltaTime = 1.f / 60.f;
	float UiScale = 1.f;
};
