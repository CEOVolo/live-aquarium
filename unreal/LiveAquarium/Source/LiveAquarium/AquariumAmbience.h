#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "AquariumAmbience.generated.h"

// Живые рыбы сцены в игре: стайки (теги School0/School1) кружат вокруг рифа строем — те же маршруты,
// что в ролике (build_sequence.py); клоуны (тег Clown) снуют у своего места. Рядом с рыбой игрока
// или акулой рыбы шарахаются в сторону и потом возвращаются в строй.
UCLASS()
class AAquariumAmbience : public AActor
{
	GENERATED_BODY()

public:
	AAquariumAmbience();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	struct FRoute
	{
		FVector Center = FVector::ZeroVector;
		FVector2D Radii = FVector2D::ZeroVector;
		float Period = 1.f;
		float Theta0 = 0.f;
		float StartHeading = 0.f;   // курс маршрута в начале, град
	};

	struct FFish
	{
		TWeakObjectPtr<AActor> Actor;
		FVector LocalCenter = FVector::ZeroVector;   // центр габарита в локальных координатах актёра
		FVector Offset = FVector::ZeroVector;        // место в строю (для клоуна — дом)
		FVector Phase = FVector::ZeroVector;
		float Wander = 10.f;
		FVector Flee = FVector::ZeroVector;
		FVector LastPos = FVector::ZeroVector;
		FVector Heading = FVector::ForwardVector;
		int32 Route = -1;                            // -1 — клоун (кружит у дома)
		float OrbitRadius = 20.f;
		float OrbitPeriod = 7.f;
	};

	void AddSchool(FName Tag, const FVector& Center, const FVector2D& Radii, float Period, bool bCenterOnGroup);
	void AddClowns();
	FVector RoutePoint(const FRoute& Route, float T, FVector* OutVelocity = nullptr) const;

	TArray<FRoute> Routes;
	TArray<FFish> Fish;
	TWeakObjectPtr<AActor> SharkActor;
	float Time = 0.f;
};
