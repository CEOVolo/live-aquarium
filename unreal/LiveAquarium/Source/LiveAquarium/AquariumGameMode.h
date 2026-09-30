#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "AquariumGameMode.generated.h"

class AAquariumFishPawn;

// Игровой режим пробы: игрок — рыба, акула охотится, стайки живут. Считает время выживания и укусы.
UCLASS()
class AAquariumGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AAquariumGameMode();

	virtual void StartPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	// Акула укусила: счёт, сообщение, возрождение рыбы.
	void OnPlayerCaught(AAquariumFishPawn* Fish);

	// Для HUD.
	int32 TimesCaught = 0;
	float SurviveTime = 0.f;
	float BestTime = 0.f;
	float CaughtMessageTime = 0.f;     // сколько ещё показывать «Тебя съели»
	bool bSharkChasing = false;         // выставляет акула
	float SharkDistance = 0.f;          // до пасти, см
};
