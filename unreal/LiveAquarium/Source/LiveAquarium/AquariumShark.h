#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AquariumShark.generated.h"

class UAnimSequence;
class USkeletalMeshComponent;

// «Мозг» акулы: ведёт акулу из сцены (тег Shark). Патруль вокруг рифа -> погоня за рыбой игрока ->
// укус (анимация bite из модели) -> отход -> патруль. Скорость погони выше хода рыбы, но ниже рывка,
// разворачивается акула медленнее рыбы — уйти можно рывком или резким манёвром.
UCLASS()
class AAquariumShark : public AActor
{
	GENERATED_BODY()

public:
	AAquariumShark();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	enum class EState : uint8 { Patrol, Chase, Bite, Retreat };

	void SetState(EState NewState);
	void Steer(const FVector& Desired, float TurnRateDeg, float Dt);
	FVector JawLocation() const;

	UPROPERTY()
	TObjectPtr<AActor> SharkActor;

	UPROPERTY()
	TObjectPtr<USkeletalMeshComponent> Mesh;

	UPROPERTY()
	TObjectPtr<UAnimSequence> SwimAnim;

	UPROPERTY()
	TObjectPtr<UAnimSequence> BiteAnim;

	EState State = EState::Patrol;
	FVector Heading = FVector::ForwardVector;
	float Speed = 170.f;
	float StateTime = 0.f;
	float PatrolAngle = 0.f;
	bool bBitten = false;
};
