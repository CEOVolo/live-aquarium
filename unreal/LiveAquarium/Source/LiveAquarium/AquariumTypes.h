#pragma once

#include "CoreMinimal.h"

// Теги актёров сцены: сцену расставляет unreal/scripts/build_scene.py, игра находит нужное по тегам
// (метки актёров в собранной игре недоступны).
namespace AquariumTags
{
	inline const FName PlayerFish(TEXT("PlayerFish"));   // корень рыбы игрока (куски прикреплены к нему)
	inline const FName Shark(TEXT("Shark"));             // акула (SkeletalMeshActor)
	inline const FName School0(TEXT("School0"));         // корни рыб большой стайки
	inline const FName School1(TEXT("School1"));         // корни рыб малой стайки
	inline const FName Clown(TEXT("Clown"));             // корни клоунов
	inline const FName StreamCam(TEXT("StreamCam"));     // камера общего плана стрима (Cam_Wide)
}

namespace AquariumMath
{
	// Поворот, при котором локальная ось модели NoseLocal смотрит вдоль Dir, а спина — вверх.
	inline FRotator AimNose(const FVector& Dir, const FVector& NoseLocal)
	{
		const FVector D = Dir.GetSafeNormal(UE_SMALL_NUMBER, FVector::ForwardVector);
		// поворот мира, при котором +X смотрит вдоль Dir, затем поправка на ось носа модели
		const FRotator Look = FRotationMatrix::MakeFromXZ(D, FVector::UpVector).Rotator();
		const FRotator NoseToX = FRotationMatrix::MakeFromXZ(NoseLocal, FVector::UpVector).Rotator();
		return (FQuat(Look) * FQuat(NoseToX).Inverse()).Rotator();
	}
}
