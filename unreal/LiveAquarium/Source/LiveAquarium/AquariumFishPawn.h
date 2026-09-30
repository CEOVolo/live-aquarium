#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "AquariumFishPawn.generated.h"

class UCameraComponent;
class UMaterialInstanceDynamic;
class USphereComponent;
class USpringArmComponent;

// Рыба игрока. Тело — рыба из сцены с тегом PlayerFish (французский ангел): при старте прикрепляется к пешке.
// Управление: мышь — куда смотреть, WASD — плыть (вперёд — туда, куда смотришь), Пробел/Ctrl — вверх/вниз,
// Shift — рывок (запас восстанавливается). Геймпад: стики, курки — вверх/вниз, A — рывок.
// V (геймпад Y) — вид «за рыбой» / камера стрима (тег StreamCam); -streamview — начать с камеры стрима.
// -autopilot: плывёт сама по кругу у рифа и снимает кадры (для автоматической проверки).
UCLASS()
class AAquariumFishPawn : public APawn
{
	GENERATED_BODY()

public:
	AAquariumFishPawn();

	virtual void BeginPlay() override;
	virtual void PossessedBy(AController* NewController) override;
	virtual void Tick(float DeltaSeconds) override;

	// Вернуть в точку старта (после укуса).
	void Respawn();

	float GetBoostEnergy() const { return BoostEnergy; }
	bool IsHelpVisible() const { return bShowHelp; }
	bool IsStreamView() const { return bStreamView; }
	FVector GetSwimVelocity() const { return Velocity; }

	UPROPERTY(VisibleAnywhere, Category = "Fish")
	TObjectPtr<USphereComponent> Collision;

	UPROPERTY(VisibleAnywhere, Category = "Fish")
	TObjectPtr<USpringArmComponent> Arm;

	UPROPERTY(VisibleAnywhere, Category = "Fish")
	TObjectPtr<UCameraComponent> Camera;

	UPROPERTY(EditAnywhere, Category = "Swim")
	float CruiseSpeed = 280.f;

	UPROPERTY(EditAnywhere, Category = "Swim")
	float BoostSpeed = 560.f;

	UPROPERTY(EditAnywhere, Category = "Swim")
	float Acceleration = 900.f;

	// Градусов поворота камеры на единицу движения мыши.
	UPROPERTY(EditAnywhere, Category = "Swim")
	float MouseSensitivity = 2.f;

	// Где можно плавать (см): над песком и не дальше края дна.
	UPROPERTY(EditAnywhere, Category = "Swim")
	FVector BoundsMin = FVector(-1200.f, -1400.f, 30.f);

	UPROPERTY(EditAnywhere, Category = "Swim")
	FVector BoundsMax = FVector(2000.f, 1400.f, 700.f);

private:
	void AdoptFishBody();
	void SetStreamView(bool bEnable);
	void ReadPlayerInput(float Dt, FVector& OutWish, bool& bOutBoost);
	void RunAutopilot(float Dt, FVector& OutWish, bool& bOutBoost);
	void MoveWithCollision(float Dt);
	void OrientBody(float Dt);

	// Материалы тела (M_Fish): амплитуда взмахов хвоста растёт со скоростью.
	UPROPERTY()
	TArray<TObjectPtr<UMaterialInstanceDynamic>> SwimMaterials;
	TArray<float> BaseAmp;

	FVector Velocity = FVector::ZeroVector;
	FTransform SpawnTransform;
	float BoostEnergy = 1.f;
	float FrozenTime = 0.f;
	float BankRoll = 0.f;
	bool bShowHelp = true;
	bool bStreamView = false;
	TWeakObjectPtr<AActor> StreamCamera;

	bool bAutopilot = false;
	float AutopilotTime = 0.f;
	float AutopilotSeconds = 0.f;   // > 0: выйти из игры по истечении
	int32 AutopilotShots = 0;
};
